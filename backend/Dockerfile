# Backend API image. Build context: backend/
#   docker build -t adv-viz-backend backend
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    MPLBACKEND=Agg \
    MPLCONFIGDIR=/tmp/matplotlib \
    RUNS_DIR=/tmp/runs \
    PYTHONPATH=/srv:/srv/evtolpy

WORKDIR /srv
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY evtolpy ./evtolpy
COPY data ./data
COPY pipelines ./pipelines
COPY app ./app

ARG GIT_SHA=dev
ARG EVTOLPY_SHA=vendored
ENV GIT_SHA=$GIT_SHA EVTOLPY_SHA=$EVTOLPY_SHA

RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin app
USER 10001
EXPOSE 8000

# One uvicorn process; sizing runs in its own pool of SIZING_WORKERS processes.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
