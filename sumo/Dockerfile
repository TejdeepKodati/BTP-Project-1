FROM ghcr.io/eclipse-sumo/sumo:1.27.1
WORKDIR /app
COPY nodes.nod.xml edges.edg.xml ./
RUN netconvert --node-files nodes.nod.xml --edge-files edges.edg.xml --output-file network.net.xml
COPY runner.py corridor_route.json predictor.py xgboost_safety_model.json ./
EXPOSE 8090
CMD ["python3", "runner.py"]
