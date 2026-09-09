"use client";

import { useTransition } from "react";
import { HOME_COLLECTION_STATUSES, type HomeCollectionStatus } from "@/lib/homeCollection";
import { updateHomeCollectionStatusAction } from "./actions";

export function HomeCollectionRowActions({
  requestId,
  status
}: {
  requestId: string;
  status: string;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <select
      disabled={isPending}
      defaultValue={status}
      onChange={(event) => {
        const next = event.target.value as HomeCollectionStatus;
        startTransition(() => {
          void updateHomeCollectionStatusAction(requestId, next);
        });
      }}
      className="rounded-md border border-slate-300 px-2 py-1 text-xs disabled:opacity-50"
    >
      {HOME_COLLECTION_STATUSES.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}
