// Where an order stands according to the emails about it. Pure; the schema
// imports it, so it uses only relative imports.

export const ORDER_STAGES = ["ordered", "shipped", "delivered"] as const;

export type OrderStage = (typeof ORDER_STAGES)[number];
