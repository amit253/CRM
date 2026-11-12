import UnifiedInbox from "@/components/unified-inbox";
import { isUnipileConfigured } from "@/lib/unipile";

type HomePageProps = {
  searchParams: Promise<{
    connection?: string;
    provider?: string;
  }>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = await searchParams;
  const connection =
    params.connection === "success" || params.connection === "failed"
      ? params.connection
      : null;

  return (
    <UnifiedInbox
      apiConfigured={isUnipileConfigured()}
      connection={connection}
      provider={params.provider ?? null}
    />
  );
}
