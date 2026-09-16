# Thinkora Core Intelligence

This directory is the permanent application-level intelligence boundary for Thinkora.

## Responsibilities

- Unified conversation context and message normalization
- Provider routing: Online, Offline, and Auto fallback
- Streaming-compatible response lifecycle
- Provider-independent response metadata
- Error/retry policy at the intelligence boundary
- Future attachment points for memory, projects, research, tools, and voice

## Provider rule

Provider credentials stay server-side. The client never receives or stores provider API keys.

## Offline rule

Offline AI is a first-class provider, not a temporary fallback demo. The Android Termux/llama.cpp launcher remains part of the permanent deployment path.

## Safety rule

Production changes must be validated on an isolated branch/service before promotion to `stable-ui`. `main` is not part of the production workflow.
