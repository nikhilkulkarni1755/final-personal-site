# From *Matrices* to Minds

[Back to Blog](/blog)
            Complete Technical Deep-Dive

How a grid of numbers — multiplied together billions of times — became the engine of modern intelligence.

Author: Nikhil Kulkarni, Claude Code

March 5, 2026 25 min read Linear Algebra Neural Networks Transformers GPUs [01 · Matrix Basics](#s1) [02 · Matrix Multiplication](#s2) [03 · Neurons & Layers](#s3) [04 · CNNs](#s4) [05 · RNNs & LSTMs](#s5) [06 · Transformers](#s6) [07 · Tokens & Embeddings](#s7) [08 · GPUs & TPUs](#s8) [09 · The Full Stack](#s9) Chapter 01

## What is a Matrix?

A matrix is just a rectangular grid of numbers — nothing more. But when you learn to multiply them, you unlock the fundamental operation behind every neural network ever built.

Imagine you have a 3×3 grid of numbers. Each position is called an **element**. The grid has **rows** (horizontal) and **columns** (vertical). We describe a matrix by its shape: rows × columns.

#### A 3×2 Matrix · "Shape is (3, 2)"

2 5 −1 3 4 0 3 rows · 2 columns

Notation: A[i][j]

Row index **i** goes top→bottom Column index **j** goes left→right So A[0][1] = **5** And A[2][0] = **4**

### Why do we need matrices?

Matrices are a compact way to represent **linear transformations** — functions that rotate, scale, stretch, or project data. Instead of writing 100 separate equations, you write one matrix operation.

💡 Key Insight — In deep learning, a matrix row is often a **data sample** and columns are **features**. A dataset of 1000 images at 28×28 pixels becomes a matrix of shape (1000, 784). Everything flows from there. Chapter 02

## Matrix Multiplication

This is *the* operation. Every layer in every neural network is fundamentally doing this one thing.

### The Rule

To multiply matrix **A** (shape m×k) by matrix **B** (shape k×n), the **inner dimensions must match**. The result is shape m×n.

shape rule

```
A      ×      B      =      C
(m × k)    (k × n)       (m × n)

↑               ↑
  These must match!
```

Each element C[i][j] is computed as the **dot product** of row i of A with column j of B:

dot product

```
C[i][j] = Σ  A[i][k] × B[k][j]
             k

= A[i][0]·B[0][j] + A[i][1]·B[1][j] + A[i][2]·B[2][j] + ...
```

### Step-by-step Example

Interactive · 2×3 times 3×2 ▶ Animate A (2×3) × B (3×2) = C (2×2) ? ? ? ? Click Animate to see each dot product computed step by step.

### FLOP Count — Why this matters for AI

Multiplying an (m×k) matrix by a (k×n) matrix requires **m × k × n multiplications and additions** — called FLOPs (Floating Point Operations). For a single transformer layer with hidden size 4096:

example

```
Weight matrix shape:     (4096 × 4096)
  Batch of 512 tokens:     (512 × 4096)

FLOPs per layer:         512 × 4096 × 4096 ≈ 8.6 Billion
  Layers in GPT-3:         96

Total FLOPs per forward pass: ~830 Billion
```

💡 Key Insight — Training GPT-3 required ~3.14 × 10²³ FLOPs. At peak A100 GPU throughput (312 TFLOPS), that would take ~32 years on a single GPU. Meta trained LLaMA-3 on ~16,000 GPUs in parallel. Chapter 03

## From Matrix Multiplication to Neural Networks

A neural network is, at its core, a sequence of matrix multiplications separated by non-linear functions.

### The Single Neuron

One neuron takes a vector of inputs **x**, multiplies by a weight vector **w**, adds a bias **b**, then applies an activation function **f**:

neuron

```
output = f( w₁x₁ + w₂x₂ + w₃x₃ + b )
         = f( w·x + b )
         = f( dot_product(w, x) + b )
```

### A Full Layer = One Matrix Multiply

A layer with **n** neurons, each looking at **m** inputs, is just one matrix multiply:

linear layer

```
Inputs:   x  shape (batch_size, m)    — B samples, m features each
  Weights:  W  shape (m, n)             — m inputs → n outputs
  Bias:     b  shape (n,)

Output = f( x @ W + b )              — shape (batch_size, n)

"@" = matrix multiply
  f   = activation (ReLU, sigmoid, etc.)
```

Input Layerx — raw features ▼ Linear: y = xW + bone matrix multiply ▼ Activation: f(y)ReLU, GELU, sigmoid... ▼ Linear: z = yW₂ + b₂another matrix multiply ▼ Output Layerpredictions / logits

### Activation Functions — The Non-Linearity

Without activation functions, stacking linear layers would still be linear (you can always combine two matrix multiplies into one). Activations are what let networks learn **curved decision boundaries**.

activations

```
ReLU(x)    = max(0, x)           ← most common in CNNs/MLPs
  GELU(x)    ≈ x·Φ(x)             ← used in GPT, BERT
  Sigmoid(x) = 1 / (1 + e⁻ˣ)     ← outputs 0→1, for gates
  Tanh(x)    = (eˣ - e⁻ˣ)/(eˣ+e⁻ˣ)  ← outputs -1→1, for RNNs
  Softmax(x) = eˣⁱ / Σeˣʲ         ← for probability distributions
```

### Backpropagation — Learning via Chain Rule

Networks learn by computing the gradient of the loss with respect to every weight, then nudging weights in the direction that reduces loss. This uses the **chain rule of calculus** applied backward through the network — hence "backprop".

gradient descent

```
Forward:  x → [W₁] → [ReLU] → [W₂] → [softmax] → loss L

Backward: ∂L/∂W₁ = ∂L/∂y₂ · ∂y₂/∂y₁ · ∂y₁/∂W₁   (chain rule)

Update:   W₁ ← W₁ - α·∂L/∂W₁     (α = learning rate)

This backward pass is ALSO mostly matrix multiplications!
```

⚡ Important — Both the **forward pass** (inference) and the **backward pass** (training) are dominated by matrix multiplications. This is why GPU/TPU hardware is designed around one thing: performing massive matrix multiplies as fast as possible. Chapter 04

## Convolutional Neural Networks (CNNs)

CNNs handle spatial data like images. They replace big matrix multiplies with sliding *filters* — but it's still matrix multiplication under the hood.

### The Convolution Operation

Instead of connecting every input pixel to every neuron (which would be enormous), a CNN uses a small **kernel/filter** (e.g., 3×3) that slides across the image, computing a dot product at each position:

convolution

```
Input image:     H × W × C    (height × width × channels)
  Filter/Kernel:   K × K × C    (usually 3×3 or 5×5)

For each position (i,j) in the output:
    output[i][j] = sum( input[i:i+K, j:j+K] ⊙ kernel )
                                ↑
                        element-wise multiply, then sum
                        = dot product of two vectors!
```

#### 3×3 Convolution — Edge Detection

Input Patch 0 255 255 0 255 255 0 0 0 ⊙ Sobel Kernel -1 0 +1 -2 0 +2 -1 0 +1 = Output 1020 Strong edge detected!

### Convolution is Matrix Multiplication (im2col)

Modern frameworks convert convolution into a matrix multiply using **im2col**: each filter application becomes a column, and you batch all of them into one big matrix multiply that GPUs love.

im2col trick

```
1. Reshape input patches → matrix of shape (N·H'·W', K²·C)
  2. Reshape filters       → matrix of shape (K²·C, F)
  3. One matrix multiply   → output of shape (N·H'·W', F)
  4. Reshape back          → (N, H', W', F)

This is why convolution training is fast: it's all GEMM!
```

### Typical CNN Architecture

Input Image (224×224×3)3 channels: R, G, B ▼ Conv Layer (64 filters, 3×3)extracts local features ▼ BatchNorm + ReLUnormalize + non-linearity ▼ MaxPool (2×2)downsample: 112×112 ▼ More Conv Blocks...deeper features emerge ▼ Global Average Poolspatial → vector ▼ Fully Connected + Softmaxfinal matrix multiply → classes Chapter 05

## Recurrent Neural Networks (RNNs & LSTMs)

CNNs handle space. RNNs handle *time* — sequences of data where the order matters, like text, audio, or sensor readings.

### The Core Idea: Hidden State

An RNN processes one token at a time, maintaining a **hidden state** h that acts as "memory" of everything seen so far. At each step:

rnn step

```
hₜ = tanh( Wₕₕ · hₜ₋₁  +  Wₓₕ · xₜ  +  b )
              ↑ previous     ↑ current
              hidden          input

yₜ = Wₕ_out · hₜ                  ← output at step t

Still just matrix multiplications!
```

### The Vanishing Gradient Problem

RNNs struggle with **long-range dependencies**. Gradients flowing backward through many time steps get multiplied by the same weight matrix repeatedly — they either **vanish** (→ 0) or **explode** (→ ∞).

### LSTM: Gated Memory

LSTMs (Long Short-Term Memory) add explicit **gates** to control what gets remembered, forgotten, or output. All gates are... matrix multiplications:

lstm gates

```
fₜ = σ( Wf · [hₜ₋₁, xₜ] + bf )   ← Forget gate: what to erase
  iₜ = σ( Wi · [hₜ₋₁, xₜ] + bi )   ← Input gate:  what to write
  g̃ₜ = tanh(Wg · [hₜ₋₁, xₜ] + bg)  ← Candidate memory
  oₜ = σ( Wo · [hₜ₋₁, xₜ] + bo )   ← Output gate: what to read

Cell:  cₜ = fₜ ⊙ cₜ₋₁ + iₜ ⊙ g̃ₜ  ← Update cell state
  Hidden: hₜ = oₜ ⊙ tanh(cₜ)        ← New hidden state

⊙ = element-wise multiply
  σ = sigmoid (outputs between 0 and 1 = "gate open/closed")
```

⚡ Important — The **fundamental problem** with RNNs and LSTMs: they must process tokens one-at-a-time, sequentially. You can't parallelize across the sequence length. This makes them slow to train and limits context length. This is what Transformers were designed to solve. Chapter 06

## Transformers & Attention

The 2017 paper "Attention Is All You Need" discarded recurrence entirely. Instead, every position attends to every other position — simultaneously, in parallel — using one elegant matrix operation.

### Self-Attention: The Core Mechanism

For each token, we compute three vectors by multiplying its embedding by three learned weight matrices:

qkv projections

```
Q = X · Wq    (Queries — "what am I looking for?")
  K = X · Wk    (Keys    — "what do I contain?")
  V = X · Wv    (Values  — "what do I output if you look at me?")

X shape:  (seq_len, d_model)       e.g., (512, 768)
  W shapes: (d_model, d_k)           e.g., (768, 64)
```

Then attention scores are computed, scaled, softmaxed, and used to weight the values:

attention formula

```
Attention(Q, K, V) = softmax( Q·Kᵀ / √d_k ) · V
                                ↑         ↑      ↑
                          dot product  scale   weighted
                          of all pairs         sum of V

Q·Kᵀ shape:  (seq_len, seq_len)    ← every token sees every token!
  After softmax: each row sums to 1 (probability distribution)
  Final output:  (seq_len, d_k)      ← rich, context-aware vectors
```

Attention Heatmap — "The cat sat on the mat" The cat sat on the mat The cat sat on the mat
          Each cell = attention weight from row-token → col-token. Darker = stronger attention.

### Multi-Head Attention

Instead of one attention pass, Transformers run **h heads** in parallel — each learning a different type of relationship (e.g., one head learns syntax, another learns coreference):

multi-head

```
head_i = Attention(X·Wq_i, X·Wk_i, X·Wv_i)

MultiHead(X) = Concat(head_1, ..., head_h) · Wo

If d_model=768, h=12:  each head d_k = 768/12 = 64

Total params per attention layer ≈ 4 × d_model²
  For d_model=768: ≈ 2.4 million params per layer
```

### The Full Transformer Block

Input Embeddingstoken embeddings + positional encoding ▼ Multi-Head Self-AttentionQ·Kᵀ/√d · V — parallel matrix ops ▼ Add & LayerNormresidual connection ▼ Feed-Forward Network2 linear layers: 4× expand then contract ▼ Add & LayerNormresidual connection ▼ → Repeat N times (e.g., 96 layers in GPT-3)

### Why Transformers Beat RNNs

Property RNN/LSTM Transformer Parallelism Sequential — can't parallelize across tokens Fully parallel — all tokens computed at once Long-range context Degrades with distance (vanishing gradients) O(1) path between any two positions Memory Fixed-size hidden state bottleneck Explicit attention over all positions Compute O(n) time per layer O(n²) attention but massively parallel Scaling Stops improving past ~1B params Power-law scaling — bigger = better Chapter 07

## Tokens & Embeddings

Before any matrix can multiply, raw text must become numbers. The tokenization pipeline is the bridge between human language and matrix operations.

### What is a Token?

Tokens are the atomic units a model sees. They are **not** words — they are subword pieces chosen to minimize vocabulary size while handling any input. Using **Byte-Pair Encoding (BPE)**:

tokenization

```
"ChatGPT is amazing!"
  → ["Chat", "G", "PT", " is", " amaz", "ing", "!"]
  → [  9890,  38,  2898,  374,  16682,   278,   0  ]
                          ↑
                    token IDs (integers)
```

### Embeddings — From ID to Vector

Each token ID is looked up in an **embedding matrix** — a learned table mapping every token to a dense vector. This lookup is itself a matrix multiply (one-hot vector times embedding matrix):

embedding lookup

```
Vocabulary size:  50,257 tokens  (GPT-2)
  Embedding dim:    768            (GPT-2 small)

Embedding matrix E:  shape (50257, 768)
  Token ID = 9890:     → E[9890]  = vector of 768 floats

Full sequence of 512 tokens → matrix (512, 768)
  This is X — the input to the first Transformer block.
```

### Positional Encoding

Attention is **permutation-invariant** — it doesn't know that token 0 comes before token 1. Positional encodings inject this order information:

sinusoidal (original)

```
PE[pos, 2i]   = sin( pos / 10000^(2i/d_model) )
  PE[pos, 2i+1] = cos( pos / 10000^(2i/d_model) )

Input to transformer = token_embedding + positional_embedding

Modern LLMs use RoPE (Rotary Position Embedding) instead —
  it applies rotation matrices directly inside attention,
  allowing better extrapolation to longer sequences.
```

### From Token to Output Probability

token IDs[9890, 38, ...] embedding lookup(vocab, d_model) + pos encoding N × Transformer blocksattention + FFN final LayerNorm lm_head · Wᵀ(d_model → vocab) softmax→ probabilities sample next token 💡 Key Insight — The final projection (d_model → vocab_size) is the largest matrix multiply in the forward pass. For Llama-3 (d_model=8192, vocab=128K): that's a matrix of shape (8192, 131072) = over 1 billion parameters in a single layer. Chapter 08

## GPUs & TPUs: The Hardware Behind the Math

Matrix multiplication is embarrassingly parallel. GPUs and TPUs are purpose-built to exploit this — they're not fast computers, they're fast matrix multipliers.

### CPU vs GPU Architecture

Property CPU (e.g. Intel Xeon) GPU (e.g. NVIDIA H100) Core count 8–128 complex cores 14,592 CUDA cores Design goal Low latency, serial tasks High throughput, parallel tasks Cache Large L1/L2/L3 cache hierarchy Small cache, high bandwidth HBM memory Memory bandwidth ~100 GB/s 3.35 TB/s (H100 SXM) FP16 FLOPS ~1–2 TFLOPS 989 TFLOPS (tensor cores) Ideal workload OS, databases, branchy code Matrix multiplies, convolutions

### Tensor Cores — The Secret Weapon

NVIDIA's Tensor Cores (introduced in Volta, 2017) execute a **4×4 matrix multiply-accumulate (MMA)** in a single clock cycle at mixed precision (FP16 inputs, FP32 accumulation). GPUs have thousands of these:

tensor core mma

```
D = A × B + C

A, B: (4×4) FP16 matrices
  C, D: (4×4) FP32 accumulator

This is a "WMMA" (Warp Matrix Multiply-Accumulate)
  One tensor core does this in 1 clock cycle.
  H100 has 528 tensor cores × 2GHz × 16 ops/cycle
  = ~989 TFLOPS in FP16
```

### CUDA Thread Hierarchy

GPUs organize computation in a hierarchy. Understanding this explains how a single matrix multiply maps to hardware:

cuda hierarchy

```
Thread  → executes one FMA (fused multiply-add) operation
  Warp    → 32 threads that execute in lockstep (SIMT)
  Block   → many warps; share fast Shared Memory (~100 KB)
  Grid    → all blocks executing the same kernel

For a matrix multiply (GEMM):
  • Each thread block computes a TILE of the output matrix
  • Tile is loaded into shared memory (fast!)
  • Inner loop multiplies the tile
  • Result written back to global GPU memory (HBM)
```

GPU — Pull Model (HBM → SRAM → Cores) ▶ Run
          HBM (High Bandwidth Memory) — 80 GB, 3.35 TB/s
          ↕ GPU idle — data sits in HBM (off-chip memory)

### Memory Hierarchy & Bandwidth

The biggest bottleneck in LLM inference isn't compute — it's **memory bandwidth**. Reading weights from HBM (high-bandwidth memory) into compute units is the bottleneck:

memory bandwidth math

```
Llama-3 70B model:    70 billion params × 2 bytes (FP16)
                      = 140 GB just to store weights

H100 HBM bandwidth:   3.35 TB/s

Time to read all weights once:  140 GB / 3.35 TB/s ≈ 42ms

At 1 token/step, this is your latency floor for 1 token.
  → This is why batching matters: same weight read, more tokens!
```

### TPUs — Google's Dedicated Matrix Engine

Google's **Tensor Processing Units** take specialization further. They're built entirely around matrix multiplication, sacrificing general-purpose computation for raw GEMM performance:

tpu architecture

```
Core component: Systolic Array
  ┌──────────────────────────────────────────────┐
  │  Matrix data flows through a grid of 256×256 │
  │  multiply-accumulate (MAC) units in a wave.  │
  │  Each MAC unit receives partial results from  │
  │  its neighbor and passes its own along.       │
  │                                              │
  │  TPU v4:  275 TFLOPS (BF16) per chip         │
  │  TPU v4 Pod: 4096 chips → ~1 ExaFLOP!        │
  └──────────────────────────────────────────────┘

Key advantages over GPU:
  • On-chip HBM closer to compute → less latency
  • Deterministic execution (no warp divergence)
  • Custom network topology (ICI) for pod scaling
  • 4x more energy-efficient for Transformer workloads
```

TPU — Push Model (Systolic Array) ▶ Run
                ↓ partial sums exit bottom edge
              ACC
            ↓
          
          Unified Buffer (On-Chip SRAM) — 24 MB
          Systolic array idle — weights pre-loaded into MAC units

### GPU vs TPU — The Architectural Difference

The fundamental difference is the data flow model. GPUs **pull** data from memory into independent compute blocks. TPUs **push** data through a grid of interconnected units in a wave. Run both side by side to see the contrast:

GPU vs TPU — Side by Side GPU — Pull Model (HBM → SRAM → Cores) ▶ Run
          HBM (High Bandwidth Memory) — 80 GB, 3.35 TB/s
          ↕ GPU idle — data sits in HBM (off-chip memory) TPU — Push Model (Systolic Array) ▶ Run
                ↓ partial sums exit bottom edge
              ACC
            ↓
          
          Unified Buffer (On-Chip SRAM) — 24 MB
          Systolic array idle — weights pre-loaded into MAC units

### Precision Formats

Not all numbers are equal in AI training. Lower precision = fewer bits = faster multiply + less memory:

Format Bits Range Use Case FP64 (double) 64 ±1.8×10³⁰⁸ Scientific computing FP32 (single) 32 ±3.4×10³⁸ Gradient accumulation, master weights BF16 16 same as FP32 Training (same range, less precision) FP16 16 ±65,504 Inference, tensor core compute INT8 8 -128 to 127 Quantized inference (2× speed) INT4 / NF4 4 16 values QLoRA, edge deployment (4× speed)

### Parallelism Strategies for Giant Models

distributed training

```
Data Parallelism    — split BATCH across GPUs; same model everywhere
                        GPUs sync gradients after each step (AllReduce)

Tensor Parallelism  — split WEIGHT MATRICES across GPUs
                        e.g., row 1–2048 on GPU0, row 2049–4096 on GPU1
                        requires AllReduce within every layer

Pipeline Parallelism — split LAYERS across GPUs
                        GPU0 runs layers 1–24, GPU1 runs 25–48...
                        uses micro-batching to keep GPUs busy

Expert Parallelism  — each GPU handles different MoE experts
                        only activates a subset of params per token

GPT-3 used: 8-way tensor × 8-way pipeline × data parallelism
              running on 1024 A100 GPUs
```

Chapter 09

## The Full Stack: Putting it All Together

Every token you generate traces through this entire stack — from characters in a text box to numbers in a matrix to probability distributions sampled into words.

### One Forward Pass, Top to Bottom

**"Paris is the capital of"** Raw text input ↓ BPE Tokenizer → [9521, 318, 262, 3139, 286]5 token IDs ↓ Embedding matrix lookup + positional encoding→ X of shape (5, 4096) ↓ 32 × Transformer BlockEach: Q=XWq, K=XWk, V=XWv → Attn(Q,K,V) → FFN → ResNorm ↓ LM head: (5, 4096) × (4096, 32000) → logits (5, 32000) ↓ Softmax → probabilities → sample last position→ token 3681 = "France"

### The Numbers Behind "Thinking"

gpt-4 class model estimates

```
Parameters:          ~1 Trillion
  Layers:              ~128 transformer blocks
  d_model:             ~12,288
  Attention heads:     ~96
  Context window:      128,000 tokens

Per-token inference:
    Matrix ops:        ~2T FLOPs
    Memory reads:      ~2 TB from HBM
    Time on H100:      ~15ms per token

Training compute:    ~10²⁵ FLOPs
  Training time:       ~3 months on ~30,000 H100s
  Training cost:       ~$100 million
```

### The Architecture Zoo

Model Family Architecture Key Innovation Primary Use ResNet, VGG CNN Skip connections, deep convolutions Image classification LSTM, GRU RNN Gated memory cells Sequential data, NLP (legacy) BERT Encoder Transformer Bidirectional attention, MLM Classification, embedding GPT family Decoder Transformer Causal attention, RLHF Text generation T5, BART Encoder-Decoder Seq2seq with cross-attention Translation, summarization ViT Vision Transformer Image patches as tokens Image understanding Mixtral, GPT-4 MoE Transformer Sparse expert routing Efficient LLM at scale Mamba, RWKV State Space Models Linear complexity attention alternatives Long context, efficiency 💡 Key Insight — Every model in this table — from the simplest CNN to the largest LLM — ultimately reduces to the same primitive operation: multiply two matrices, add them together, apply a non-linearity. **The miracle of deep learning is that this simple operation, composed deeply enough, with enough data, gives rise to everything from edge detection to reasoning about the world.** 🖥 Hardware — The hardware race is fundamentally a race to multiply larger matrices faster. NVIDIA H100 → H200 → Blackwell B200 are all improvements in one metric: how many FP8/FP16 multiply-accumulate operations can we execute per second, and how fast can we feed them with memory bandwidth. viewing now
      Views Likes Comments [Back to Blog](/blog)
