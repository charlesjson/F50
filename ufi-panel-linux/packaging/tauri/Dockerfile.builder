FROM debian:bookworm-slim
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    build-essential pkg-config libwebkit2gtk-4.1-dev libayatana-appindicator3-dev libssl-dev \
    librsvg2-dev patchelf file curl ca-certificates nodejs xvfb xauth dbus-x11 \
    webkit2gtk-driver fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace
ENV PATH=/rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin:$PATH \
    CARGO_HOME=/cargo RUSTUP_HOME=/rustup CARGO_TARGET_DIR=/workspace/build/tauri-debian-target
RUN useradd --create-home --uid 1000 tester
RUN apt-get update && apt-get install -y --no-install-recommends x11-apps x11-utils && rm -rf /var/lib/apt/lists/*
RUN apt-get update && apt-get install -y --no-install-recommends openbox xdotool && rm -rf /var/lib/apt/lists/*
