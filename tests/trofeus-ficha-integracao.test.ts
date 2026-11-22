import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 22/11/2026. A ficha de produção do troféu entra em DOIS lugares (o modal do quadro e a aba Itens da OS) e só mostra o que
 * a produção precisa. Estes testes travam as ligações e o que a ficha NÃO faz (mostrar dinheiro, piscar em OS sem troféu,
 * ler o banco pelo navegador).
 */
const ler = (c: string) => readFileSync(c, "utf8");
const ficha = ler("src/components/trofeus/ficha-do-trofeu.tsx");
const quadro = ler("src/components/kanban/ficha-da-os.tsx");
const os = ler("src/routes/_authenticated/os.$id.tsx");

describe("a ficha do troféu na OS", () => {
  it("aparece no modal do quadro, dentro de 'O que vai ser produzido', e na aba Itens da OS", () => {
    expect(quadro).toContain('import { FichaDoTrofeuDaOs } from "@/components/trofeus/ficha-do-trofeu";');
    const bloco = quadro.slice(quadro.indexOf('<Bloco titulo="O que vai ser produzido">'), quadro.indexOf('<Bloco titulo="Combinado e equipe">'));
    expect(bloco).toContain("<FichaDoTrofeuDaOs osId={os.id} />");
    expect(os).toContain('import { FichaDoTrofeuDaOs } from "@/components/trofeus/ficha-do-trofeu";');
    expect(os).toContain('<div className="mt-4"><FichaDoTrofeuDaOs osId={id} /></div></TabsContent>');
  });

  it("a aba Itens segue com a mesma chamada de ItensDaOS (as travas de permissão não mudam)", () => {
    expect(os).toContain("podeEditarItens={podeEditarItensDaOS(hasPermission)}");
    expect(os).toContain("<ItensDaOS osId={id} canSeeFinancials={canSeeFinancials} canSeePrices={canSeePrices} nivelDeVisao={nivelDeVisao}");
  });

  it("tudo vem do servidor: nenhuma leitura de tabela pelo navegador", () => {
    expect(ficha).toContain("fichaDoTrofeuDaOs({ data: { osId } })");
    expect(ficha).not.toMatch(/from\("/);
    expect(ficha).not.toContain("@/integrations/supabase/client");
    expect(ficha).not.toContain("@/domain/trofeus/conta");
    expect(ficha).not.toContain("@/domain/trofeus/cotacao");
  });

  it("não mostra dinheiro nem fala de custo: a tela não tem formatador de real nem coluna de valor", () => {
    expect(ficha).not.toContain("R$");
    expect(ficha).not.toMatch(/\bbrl\(|toLocaleString\("pt-BR",\s*\{\s*style:\s*"currency"/);
    expect(ficha).not.toMatch(/valor_|custo_|multiplicador|margem/);
  });

  it("OS sem troféu não mostra nada nem pisca 'carregando' (a maioria das OS não tem troféu)", () => {
    expect(ficha).toContain("if (q.isPending) return null;");
    expect(ficha).toContain("if (!q.data || q.data.length === 0) return null;");
  });

  it("falha na leitura vira aviso em português, não tela em branco", () => {
    expect(ficha).toContain('data-testid="ficha-falhou"');
    expect(ficha).toContain("mensagemErro(q.error)");
    expect(ficha).toContain('role="status"');
  });

  it("diz quando as medidas ainda são estimadas e quando falta velocidade de corte", () => {
    expect(ficha).toContain('data-testid="ficha-provisoria"');
    expect(ficha).toContain("Confira com a arte aprovada antes de cortar.");
    expect(ficha).toContain('data-testid="ficha-sem-velocidade"');
  });

  it("segue os guardas de interface: sem title=, sem text-primary, sem letra fixa pequena; tabela com legenda e cabeçalhos", () => {
    expect(ficha).not.toMatch(/\btitle=/);
    expect(ficha).not.toMatch(/\btext-primary\b/);
    expect(ficha).not.toMatch(/text-\[(\d+(?:\.\d+)?)(px|rem)\]/);
    expect(ficha).toContain('<caption className="sr-only">');
    expect(ficha).toContain('scope="col"');
    expect(ficha).toContain('scope="row"');
    expect(ficha).toContain("overflow-x-auto");
  });

  it("o modal do quadro e a tela da OS continuam sem title= novo (travado por title-vira-texto-visivel)", () => {
    expect((quadro.match(/\btitle=/g) ?? []).length).toBe(0);
  });
});
