# LOOM (University of Freiburg, GPL-3.0, github.com/ad-freiburg/loom): draws transit
# lines side by side through junctions, each in its lane. Used by
# scripts/offline_maps (transit.py) for the trams' and metros' tiles. Built from a
# pinned commit with the free solvers only (LOOM's own image fetches Gurobi, which
# needs a licence).
FROM ubuntu:22.04
ARG LOOM_COMMIT=1e4757838104d1e4d22186c9b77d5fc4b98681a0
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install --no-install-recommends -y \
      ca-certificates git make cmake g++ pkg-config zlib1g-dev \
      libglpk-dev glpk-utils coinor-libcbc-dev coinor-cbc \
      libprotobuf-dev protobuf-compiler libzip-dev \
    && rm -rf /var/lib/apt/lists/*
RUN git clone https://github.com/ad-freiburg/loom /loom \
    && cd /loom && git checkout "$LOOM_COMMIT" && git submodule update --init --recursive \
    && mkdir build && cd build && cmake .. && make -j4 install \
    && rm -rf /loom
WORKDIR /w
