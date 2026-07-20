FROM python:3.11-slim

WORKDIR /app

# libgl1/libglib2.0-0: opencv (Sprint OCR-02). libsm6/libxext6/libxrender1:
# opencv-contrib-python specifically (Sprint OCR-03 — paddlex[ocr-core]
# hard-pins opencv-contrib-python over -headless; it links a few more
# shared libs even though this container never opens a display).
# fonts-dejavu-core: satisfies PaddleX's PADDLE_PDX_LOCAL_FONT_FILE_PATH
# locally (see app/config.py) so importing paddleocr never makes a
# network call to fetch a debug-visualization font.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 libgl1 libsm6 libxext6 libxrender1 fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Where PaddleOCR/PaddleX model weights are cached — mounted as a
# persistent volume by docker-compose.yml so a restart never re-downloads
# them (design brief §3: "do not silently download models during every
# container startup").
ENV OCR_MODEL_CACHE_PATH=/models
RUN mkdir -p /models

EXPOSE 8100
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8100"]
