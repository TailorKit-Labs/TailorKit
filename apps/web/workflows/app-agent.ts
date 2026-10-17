// The host compiler discovers the package workflow through this entry point.
export { appAgent } from "@tailorkit/agent-fx/workflows";

// Keep the original workflow registered for Pi turns already in flight.
export { appAgent as piAppAgent } from "@tailorkit/agent/workflows";
