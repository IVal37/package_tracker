import { AddPackageForm } from "@/components/add-package-form";
import { ShipmentDrawer } from "@/components/shipment-drawer";
import { ShipmentList } from "@/components/shipment-list";
import { SiteHeader } from "@/components/site-header";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { getShipmentDetail, listShipments } from "@/lib/db/shipments";
import { groupShipmentsByStatus } from "@/lib/shipments/grouping";
import { signOut } from "./sign-in/actions";
import { addPackageAction, deletePackageAction } from "./actions";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ shipment?: string | string[] }>;
}) {
  const user = await requireUser();
  const { shipment } = await searchParams;
  const shipmentId = typeof shipment === "string" ? shipment : undefined;

  const db = getDb();
  const now = new Date();
  // Both lookups are scoped to the signed-in user; a shipment id that belongs
  // to someone else simply yields no drawer.
  const [items, detail] = await Promise.all([
    listShipments(db, user.id),
    shipmentId ? getShipmentDetail(db, user.id, shipmentId) : null,
  ]);

  return (
    <>
      <SiteHeader email={user.email} signOutAction={signOut} />
      <main className="mx-auto max-w-3xl space-y-8 px-4 py-8">
        <AddPackageForm action={addPackageAction} />
        <ShipmentList groups={groupShipmentsByStatus(items)} now={now} />
      </main>
      {detail && (
        <ShipmentDrawer
          shipment={detail.shipment}
          checkpoints={detail.checkpoints}
          now={now}
          deleteAction={deletePackageAction}
        />
      )}
    </>
  );
}
