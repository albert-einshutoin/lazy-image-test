# Node.js 20 with Rust toolchain for lazy-image native build
# Use x86_64 platform as lazy-image doesn't support Linux ARM64
FROM --platform=linux/amd64 node:20-bookworm

# Install build dependencies for lazy-image (Rust, nasm for mozjpeg SIMD)
RUN apt-get update && apt-get install -y \
    build-essential \
    nasm \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Rust
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

WORKDIR /app

# Copy package files
COPY package*.json ./

# Clear npm cache and install dependencies
RUN npm cache clean --force && npm install --no-optional && npm install

# Copy source code
COPY . .

# Create directories for uploads and output
RUN mkdir -p uploads output

EXPOSE 4000

CMD ["node", "src/index.js"]

