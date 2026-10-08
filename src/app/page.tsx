import { AddPackageForm } from "@/components/add-package-form";
import { ShipmentDrawer } from "@/components/shipment-drawer";
import { ShipmentList } from "@/components/shipment-list";
import { ShipmentMap } from "@/components/shipment-map";
import { SiteHeader } from "@/components/site-header";
import { ViewToggle } from "@/components/view-toggle";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { getOrderForShipment, listOrderPlaceholders } from "@/lib/db/orders";
import {
  getShipmentDetail,
  listMapShipments,
  listShipments,
  type ShipmentDetail,
} from "@/lib/db/shipments";
import { shipmentMode, type ModeCheckpoint } from "@/lib/geo/infer-mode";
import { buildMapData } from "@/lib/geo/map-data";
import { groupShipmentsByStatus } from "@/lib/shipments/grouping";
import { signOut } from "./sign-in/actions";
import {
  addPackageAction,
  deletePackageAction,
  dismissOrderAction,
} from "./actions";

type Param = string | string[] | undefined;

const single = (value: Param) =>
  typeof value === "string" ? value : undefined;

/** The detail's checkpoints (newest first) as inputs for mode inference. */
function detailMode(detail: ShipmentDetail) {
  const oldestFirst: ModeCheckpoint[] = [...detail.checkpoints]
    .reverse()
    .map((checkpoint) => ({
      status: checkpoint.status,
      message: checkpoint.message,
      locationText: checkpoint.locationText,
      occurredAt: checkpoint.occurredAt,
      point:
        checkpoint.lat !== null && checkpoint.lng !== null
          ? { lat: checkpoint.lat, lng: checkpoint.lng }
          : null,
    }));
  return shipmentMode(oldestFirst);
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ shipment?: Param; view?: Param }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const shipmentId = single(params.shipment);
  const view = single(params.view) === "map" ? "map" : "list";

  const db = getDb();
  const now = new Date();
  // Every lookup is scoped to the signed-in user; a shipment id that belongs
  // to someone else simply yields no drawer.
  const [content, orders, detail] = await Promise.all([
    view === "map"
      ? listMapShipments(db, user.id).then(buildMapData)
      : listShipments(db, user.id).then(groupShipmentsByStatus),
    // Only the list has an "Ordered" section.
    view === "map" ? [] : listOrderPlaceholders(db, user.id),
    shipmentId
      ? getShipmentDetail(db, user.id, shipmentId).then(async (found) =>
          found
            ? {
                ...found,
                order: await getOrderForShipment(
                  db,
                  user.id,
                  found.shipment.id,
                ),
              }
            : null,
        )
      : null,
  ]);

  return (
    <>
      <SiteHeader email={user.email} signOutAction={signOut} />
      <main className="mx-auto max-w-3xl space-y-8 px-4 py-8">
        <AddPackageForm action={addPackageAction} />
        <ViewToggle view={view} />
        {"placed" in content ? (
          <ShipmentMap data={content} />
        ) : (
          <ShipmentList
            groups={content}
            now={now}
            orders={orders}
            dismissOrderAction={dismissOrderAction}
          />
        )}
      </main>
      {detail && (
        <ShipmentDrawer
          shipment={detail.shipment}
          checkpoints={detail.checkpoints}
          now={now}
          deleteAction={deletePackageAction}
          closeHref={view === "map" ? "/?view=map" : "/"}
          mode={detailMode(detail)}
          order={detail.order}
        />
      )}
    </>
  );
}
