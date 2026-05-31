import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, FileText, Eye } from "lucide-react";
import { toast } from "sonner";

type Props = {
  tipo: "orcamento" | "os";
  referencia_id: string;
};

export function PDFHistoryCard({ tipo, referencia_id }: Props) {
  const { data = [] } = useQuery({
    queryKey: ["documentos-gerados", tipo, referencia_id],
    queryFn: async () => {
      const { data } = await supabase
        .from("documentos_gerados")
        .select("*")
        .eq("tipo", tipo)
        .eq("referencia_id", referencia_id)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  async function abrir(caminho: string, baixar = false) {
    const { data, error } = await supabase.storage
      .from("documentos-pdf")
      .createSignedUrl(caminho, 60 * 60);
    if (error || !data?.signedUrl) {
      toast.error("Não foi possível gerar link");
      return;
    }
    if (baixar) {
      const a = document.createElement("a");
      a.href = data.signedUrl;
      a.download = caminho.split("/").pop() ?? "documento.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } else {
      window.open(data.signedUrl, "_blank");
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="h-4 w-4" /> Histórico de PDFs
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {data.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhum PDF gerado ainda.</p>
        )}
        {data.map((d: any) => (
          <div key={d.id} className="flex items-center justify-between p-2 rounded border bg-card text-sm">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <div>
                <div className="font-medium">
                  {tipo === "orcamento" ? "Orçamento" : "OS"} #{d.numero}{" "}
                  <Badge variant={d.variante === "producao" ? "secondary" : "outline"} className="ml-1">
                    {d.variante}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  {new Date(d.created_at).toLocaleString("pt-BR")}
                  {d.tamanho_bytes ? ` · ${(d.tamanho_bytes / 1024).toFixed(1)} KB` : ""}
                </div>
              </div>
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => abrir(d.caminho, false)}>
                <Eye className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => abrir(d.caminho, true)}>
                <Download className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
