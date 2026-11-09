// Where an order stands according to the emails about it. Pure; the schema
// imports it, so it uses only relative imports.

export const ORDER_STAGES = ["ordered", "shipped", "delivered"] as const;

export type OrderStage = (typeof ORDER_STAGES)[number];

/** The stage an email of this kind reports, or null for an email that says nothing about one. */
export function stageForEmailType(emailType: string): OrderStage | null {
  switch (emailType) {
    case "order_confirmation":
      return "ordered";
    case "shipping_confirmation":
      return "shipped";
    case "delivery_update":
      return "delivered";
    default:
      return null;
  }
}

/**
 * Whether an email sets the order's stage. Decided by when the email arrived,
 * never by ranking the stages (as with a shipment's status): the newest email
 * wins, and a late older one changes nothing.
 */
export function shouldSetStage(
  current: { stageAt: Date | null },
  arrivedAt: Date,
): boolean {
  return current.stageAt === null || arrivedAt > current.stageAt;
}
