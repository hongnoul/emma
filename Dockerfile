# Rare Disease Atlas API — serving container.
# Judgments are precomputed into the graph JSON at build time, so this image
# needs no model, no GPU: it's a stateless reader (~200 MB).
FROM python:3.12-slim

WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app ./app
# Bake the published generation into the image. Swap which file to serve
# with ATLAS_GRAPH_PATH (graph.json = demo, graph.real.json = 10-disease
# cluster, graph.bulk.json = all rare diseases).
COPY data/graph.json data/question_packs.json data/gold_labels.json data/laya_judgments_zeroshot.json /data/
COPY data/graph.real.json* data/graph.bulk.json* /data/

ENV ATLAS_DATA_DIR=/data
ENV ATLAS_GRAPH_PATH=/data/graph.bulk.json
ENV PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
