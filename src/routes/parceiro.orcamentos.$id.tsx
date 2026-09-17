import { createFileRoute } from "@tanstack/react-router";
import { EditorDeOrcamento } from "@/components/parceiro/editor-de-orcamento";

export const Route = createFileRoute("/parceiro/orcamentos/$id")({
  component: RotaDoEditor,
});

function RotaDoEditor() {
  const { id } = Route.useParams();
  // key: trocar de orçamento (ex.: depois de duplicar) remonta o editor do zero
  return <EditorDeOrcamento key={id} id={id} />;
}
