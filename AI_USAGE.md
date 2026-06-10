# AI Usage

## Tools used
- **Claude (Antigravity) / ChatGPT:** Used as a pair programming assistant to accelerate development, identify edge cases, and generate boilerplate code.

## How I used AI

1. **Code Review & Bug Discovery:** I fed the existing backend codebase to the AI for an initial security and concurrency scan. It acted as an excellent "second set of eyes," helping to quickly surface the TOCTOU race condition in the rate limiter and the `send_log` ordering bug, which I then manually verified, wrote tests for, and fixed.
2. **Boilerplate Generation:** I used AI to scaffold the initial Vite + React + TypeScript frontend and generate the foundational CSS structure. This saved time and allowed me to focus on the core system architecture and React component design.
3. **Brainstorming Logic:** I used the AI as a sounding board when designing the `resumeSequence` logic, particularly to bounce around ideas on how to optimally handle the `delay_days` offsets alongside the mailbox budget enforcement.

## Prompts that worked well

### Prompt 1: Resume logic brainstorming
> "I need to implement resumeSequence. How should we handle recalculating the scheduled_at times based on delay_days, while respecting the daily remaining budget per mailbox?"

This was effective because it helped me quickly map out the algorithm. The AI generated a solid first pass of the logic. The grouping-by-prospect approach and budget-overflow constraints were concepts that I took, refined, and integrated into the final TypeScript implementation.

### Prompt 2: CSS Design System Baseline
> "Provide a base CSS structure for a modern dark-theme dashboard with CSS variables for colors, typography, and common utility classes."

This prompt gave me a great starting point for the frontend styling. I took the base variables and expanded them into the premium aesthetic and micro-animations seen in the final application, avoiding the need to write the entire CSS reset and token system from scratch.

## When AI led me astray

### Rate limiter fix — over-engineering
When evaluating solutions for the rate limiter race condition, the AI strongly suggested using a **Lua script** for the atomic check-and-increment logic. While technically correct and atomic, I recognized that introducing Lua would add unnecessary complexity to the codebase (e.g., script caching management, potential cluster compatibility issues down the line). 

I decided against the AI's suggestion and instead designed a cleaner, more maintainable solution using a Redis `MULTI/EXEC` pipeline to increment first, check the limit, and rollback (`DECR`) if exceeded. This achieved the required atomicity while keeping the logic readable and entirely within TypeScript.
