import UnifiedInbox from "@/components/unified-inbox";
import { isUnipileConfigured } from "@/lib/unipile";
import { isOpenRouterConfigured } from "@/lib/openrouter-config";

type InboxPageProps = {
  searchParams: Promise<{
    connection?: string;
    provider?: string;
    reason?: string;
  }>;
};

export default async function InboxPage({ searchParams }: InboxPageProps) {
  const params = await searchParams;
  const connection =
    params.connection === "success" || params.connection === "failed"
      ? params.connection
      : null;

  return (
    <UnifiedInbox
      apiConfigured={isUnipileConfigured()}
      aiConfigured={isOpenRouterConfigured()}
      connection={connection}
      provider={params.provider ?? null}
      reason={params.reason ?? null}
    />
  );
}
