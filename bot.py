import asyncio
import logging
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import urlparse

from telegram import Update
from telegram.constants import ChatAction
from telegram.ext import Application, CommandHandler, ContextTypes, MessageHandler, filters

logging.basicConfig(
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    level=logging.INFO,
)
log = logging.getLogger("typetube_bot")

BOT_TOKEN = os.getenv("BOT_TOKEN", "").strip()
TYPETUBE_API_KEY = os.getenv("TYPETUBE_API_KEY", "").strip()
MAX_FILE_MB = int(os.getenv("MAX_FILE_MB", "48"))
DOWNLOAD_DIR = Path(os.getenv("DOWNLOAD_DIR", "downloads"))
DEFAULT_QUALITY = os.getenv("DEFAULT_QUALITY", "720p")
ALLOWED_QUALITIES = {"360p", "480p", "720p", "1080p", "1440p", "2160p", "highest"}
TYPETUBE_COMMAND = os.getenv("TYPETUBE_COMMAND", "npx --yes typetube").split()

YOUTUBE_URL = re.compile(
    r"^(https?://)?(www\\.)?(youtube\\.com/watch\\?v=[\\w-]+|youtu\\.be/[\\w-]+|youtube\\.com/shorts/[\\w-]+)(?:[&?][^\\s]*)?$",
    re.IGNORECASE,
)


def valid_youtube_url(text: str) -> bool:
    value = text.strip()
    if not value or len(value) > 2048:
        return False
    candidate = value if "://" in value else "https://" + value
    try:
        parsed = urlparse(candidate)
    except ValueError:
        return False
    if parsed.scheme not in {"http", "https"}:
        return False
    host = (parsed.hostname or "").lower()
    return host in {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "www.youtu.be"} and bool(
        re.search(r"(?:watch\\?v=|youtu\\.be/|/shorts/)[\\w-]{6,}", candidate, re.I)
    )


def type_tube_env() -> dict:
    env = os.environ.copy()
    if TYPETUBE_API_KEY:
        env["TYPETUBE_API_KEY"] = TYPETUBE_API_KEY
    return env


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message:
        await update.message.reply_text(
            "🎬 *TypeTube Downloader*\n\n"
            "Send a YouTube video URL and I’ll try to download it.\n\n"
            "Commands:\n"
            "/start — Start the bot\n"
            "/help — Usage and limits\n"
            "/quality 720p — Set video quality\n"
            "/cancel — Cancel the current download\n\n"
            "Only download content you have permission to save. Availability depends on TypeTube service access.",
            parse_mode="Markdown",
        )


async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message:
        await update.message.reply_text(
            f"Send a YouTube video link in chat.\n"
            f"Quality options: {', '.join(sorted(ALLOWED_QUALITIES))}.\n"
            f"Current quality: {context.user_data.get('quality', DEFAULT_QUALITY)}.\n"
            f"Telegram upload size cap configured here: {MAX_FILE_MB} MiB.\n\n"
            "The server must have Node.js 18+ and FFmpeg installed. The Telegram Bot API or hosting provider may enforce lower limits."
        )


async def set_quality(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return
    if not context.args or context.args[0].lower() not in ALLOWED_QUALITIES:
        await update.message.reply_text("Usage: /quality 720p\nOptions: " + ", ".join(sorted(ALLOWED_QUALITIES)))
        return
    context.user_data["quality"] = context.args[0].lower()
    await update.message.reply_text(f"✅ Quality set to {context.user_data['quality']}.")


async def cancel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    task = context.user_data.get("download_task")
    if task and not task.done():
        task.cancel()
        await update.message.reply_text("Cancellation requested.")
    else:
        await update.message.reply_text("There is no active download.")


async def run_download(url: str, quality: str, workdir: Path) -> Path:
    workdir.mkdir(parents=True, exist_ok=True)
    command = [
        *TYPETUBE_COMMAND, "download", url, str(workdir),
        "--video", "--media", "--format", quality, "--workers", "4",
    ]
    # TypeTube documents CLI arguments; don't pass a user's raw text to a shell.
    proc = await asyncio.create_subprocess_exec(
        *command,
        cwd=str(workdir),
        env=type_tube_env(),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    try:
        output, _ = await asyncio.wait_for(proc.communicate(), timeout=900)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        raise RuntimeError("Download timed out after 15 minutes.") from None
    if proc.returncode != 0:
        detail = output.decode("utf-8", errors="replace")[-1200:].strip()
        log.warning("TypeTube CLI failed (exit %s): %s", proc.returncode, detail)
        if "429" in detail or "quota" in detail.lower():
            raise RuntimeError("TypeTube rate limit or quota reached. Please try again later.")
        raise RuntimeError("TypeTube could not download this video. Check service access, URL, and server logs.")
    media = [
        p for p in workdir.rglob("*")
        if p.is_file() and p.suffix.lower() in {".mp4", ".mkv", ".webm", ".mov"}
    ]
    if not media:
        detail = output.decode("utf-8", errors="replace")[-800:].strip()
        log.warning("CLI returned success but no media file was found: %s", detail)
        raise RuntimeError("Download finished but no video file was found.")
    return max(media, key=lambda p: p.stat().st_size)


async def handle_url(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    message = update.effective_message
    if not message or not message.text:
        return
    url = message.text.strip()
    if not valid_youtube_url(url):
        await message.reply_text("Please send a valid YouTube video, Shorts, or youtu.be link.")
        return
    if context.user_data.get("download_task") and not context.user_data["download_task"].done():
        await message.reply_text("You already have a download running. Use /cancel first.")
        return
    status = await message.reply_text("🔎 Checking the video and preparing download…")
    quality = context.user_data.get("quality", DEFAULT_QUALITY)
    try:
        async with asyncio.timeout(920):
            with tempfile.TemporaryDirectory(prefix="typetube-") as tmp:
                workdir = Path(tmp)
                await context.bot.send_chat_action(message.chat_id, ChatAction.UPLOAD_VIDEO)
                media = await run_download(url, quality, workdir)
                size = media.stat().st_size
                if size > MAX_FILE_MB * 1024 * 1024:
                    await status.edit_text(
                        f"File is {size / (1024 * 1024):.1f} MiB, above this bot’s configured upload cap "
                        f"({MAX_FILE_MB} MiB). Try a lower quality with /quality 480p."
                    )
                    return
                await status.edit_text(f"⬆️ Uploading {media.name} ({size / (1024 * 1024):.1f} MiB)…")
                with media.open("rb") as handle:
                    if media.suffix.lower() == ".mp4":
                        await message.reply_video(video=handle, caption=f"🎬 {media.stem}", read_timeout=180, write_timeout=180)
                    else:
                        await message.reply_document(document=handle, caption=f"🎬 {media.name}", read_timeout=180, write_timeout=180)
                await status.delete()
    except asyncio.CancelledError:
        await status.edit_text("Download cancelled.")
        raise
    except TimeoutError:
        await status.edit_text("The operation timed out. Try again or choose a lower quality.")
    except RuntimeError as exc:
        await status.edit_text(f"❌ {exc}")
    except Exception:
        log.exception("Unexpected download error")
        await status.edit_text("❌ Something went wrong. Please try again later.")


def main() -> None:
    if not BOT_TOKEN:
        raise SystemExit("BOT_TOKEN is missing. Add it to your environment.")
    if shutil.which(TYPETUBE_COMMAND[0]) is None:
        raise SystemExit(f"Cannot find command: {TYPETUBE_COMMAND[0]}. Install Node.js/npm first.")
    app = Application.builder().token(BOT_TOKEN).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("help", help_command))
    app.add_handler(CommandHandler("quality", set_quality))
    app.add_handler(CommandHandler("cancel", cancel))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_url))
    log.info("TypeTube Telegram bot starting")
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
