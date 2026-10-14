// The host CLI owns validation of this versioned document; the agent only forwards its JSON encoding.
// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Host schemas are opaque to the framework-independent agent.
export type HostSchemaDocument = Record<string, unknown>;
