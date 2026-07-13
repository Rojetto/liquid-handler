# Project Instructions

## Project Goal

Build a browser-based, real-time, high-level simulation of a liquid handling robot for wet lab workflows.

The simulation should prioritize being understandable, interactive, and visually useful over being physically exact. It should model the main concepts of automated liquid handling well enough to reason about robot movement, deck layout, wells, pipette tips, aspirate/dispense actions, and protocol flow.

## Product Direction

- The app should run locally in the browser as a static web app.
- There should be no backend server requirement for the final app.
- The first screen should be the usable simulation interface, not a marketing or landing page.
- The 3D visualization is central to the experience and should make the robot/deck state easy to inspect.
- Simulation fidelity can be approximate, but behavior should be coherent and deterministic where practical.
- Favor a small, clear codebase that can grow into more realistic robot and protocol behavior over time.

## Technology Choices

- Language: TypeScript.
- App/build tooling: Vite with the vanilla TypeScript template.
- 3D rendering: three.js.
- Runtime target: modern desktop browsers.
- Dependencies should be kept to an absolute minimum.
- Avoid frontend frameworks unless there is a strong, concrete reason to add one.
- Prefer browser-native APIs and small local modules over new packages.

## Architecture Guidance

- Keep simulation/domain logic separate from three.js rendering code.
- Use plain TypeScript types and classes/interfaces for robot state, deck state, labware, wells, tips, commands, and simulation time.
- Let the simulation update from an explicit time step so it can run in real time and remain testable.
- Treat three.js objects as a view of simulation state, not the source of truth.
- Keep coordinate systems and units documented in code where they are introduced.
- Avoid premature physical accuracy; represent volumes, positions, and robot motion at the level needed for clear visualization and protocol reasoning.

## Visualization Guidance

- Use three.js directly.
- Use `OrbitControls` from `three/addons/controls/OrbitControls.js` if camera inspection is needed.
- Build recognizable deck elements: robot gantry/arm, pipette head, labware slots, well plates, reservoirs, tip racks, and liquid levels.
- Prefer simple procedural geometry before introducing external 3D assets.
- Keep frame updates efficient enough for real-time interaction.

## Development Standards

- Keep files and modules small enough to inspect easily.
- Use descriptive names for simulation concepts.
- Add comments only where they clarify non-obvious simulation assumptions or coordinate conventions.
- Do not introduce large abstractions before the model demands them.
- When adding dependencies, justify why native TypeScript/browser/three.js functionality is insufficient.
- Before finishing meaningful code changes, run the available type check/build command.

## Expected Initial Setup

The intended starting point is:

```bash
npm create vite@latest . -- --template vanilla-ts
npm install three
```

The final app should be buildable into static files with Vite and runnable locally during development with the Vite dev server.
