import type { PluginClientContext } from "@getpaseo/plugin/client";
import { StatusRow } from "./client/status-row";
import { STATUS_KIND, STATUS_VERSION, statusSchema } from "./shared/status";

export default function contribute(client: PluginClientContext) {
  const remove = client.addTimelineRenderer({
    kind: STATUS_KIND,
    version: STATUS_VERSION,
    schema: statusSchema,
    Component: StatusRow,
  });
  return () => remove();
}
