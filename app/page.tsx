import CRMWorkspace from "@/components/crm-workspace";
import { isOpenRouterConfigured } from "@/lib/openrouter-config";
import { isUnipileConfigured } from "@/lib/unipile";

export default function HomePage() {
  return (
    <CRMWorkspace
      aiConfigured={isOpenRouterConfigured()}
      unipileConfigured={isUnipileConfigured()}
    />
  );
}
