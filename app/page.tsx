import CRMWorkspace from "@/components/crm-workspace";
import { isOpenRouterConfigured } from "@/lib/openrouter-config";
import { isUnipileConfigured } from "@/lib/unipile";

// Evaluate server feature keys for each request so the UI reflects runtime env.
export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <CRMWorkspace
      aiConfigured={isOpenRouterConfigured()}
      unipileConfigured={isUnipileConfigured()}
    />
  );
}
