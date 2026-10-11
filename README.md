# TypeTube Telegram Downloader (Python)

A Telegram bot written in Python that accepts YouTube links and invokes the TypeTube CLI to download video/audio and upload the result to Telegram. This repository is separate from the original [TypeTube SDK](https://github.com/botstelegram7-cmyk/typetube); it does not change the SDK source.

## Features

- `/start` and `/help` instructions
- YouTube video, Shorts, and `youtu.be` URLs
- `/quality 360p|480p|720p|1080p|1440p|2160p|highest`
- `/cancel` command
- Environment-based credentials and subprocess execution without shell interpolation
- Timeouts, basic file-size check, temporary download directory, and user-facing errors
- Dockerfile included

## Requirements

- Python 3.10+
- Node.js 18+ and npm
- FFmpeg (required to mux audio and video)
- Telegram bot token from [@BotFather](https://t.me/BotFather)
- Access to the TypeTube service; an API key may be needed depending on access/quota

## Run locally

```bash
python -m venv .venv
source .venv/bin/activate     # Windows: .venv\\Scripts\\activate
pip install -r requirements.txt
cp .env.example .env
```

Set `BOT_TOKEN` and optional `TYPETUBE_API_KEY` in your shell or deployment environment. The bot reads environment variables directly and **does not load `.env` automatically**. Export values before running, or install `python-dotenv` and call `load_dotenv()` before config is read.

Check dependencies and run:

```bash
node --version
npx --yes typetube --help
ffmpeg -version
python bot.py
```

The bot invokes the documented TypeTube media download CLI options. If TypeTube changes its CLI, update `run_download()` accordingly.

## Docker

```bash
docker build -t typetube-telegram-bot .
docker run --rm -e BOT_TOKEN='YOUR_TOKEN' -e TYPETUBE_API_KEY='OPTIONAL_KEY' typetube-telegram-bot
```

Never commit `.env` or a real token/API key. Rotate any credential that is accidentally published.

## Notes and limits

- The default upload cap is 48 MiB. Adjust `MAX_FILE_MB` for your Telegram API/hosting environment; the actual platform limit may be lower.
- `TYPETUBE_COMMAND` is split into executable/arguments and must not contain shell syntax.
- Only download material you own or are authorized to save. Respect YouTube's terms, copyright, and applicable law.
- TypeTube availability, quota, regional behavior and CLI syntax can change. This bot cannot guarantee every URL will work or bypass restrictions.
- Test on the intended hosting platform before relying on it in production.

## License

Bot code is provided under the MIT License. TypeTube remains a separate project with its own license and service terms.
