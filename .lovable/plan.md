# Plano — Geração de PDF de Orçamento e Ordem de Serviço

Baseado no layout do PDF anexado (Talento Digital — Pedido 90401), vamos criar uma geração de PDF profissional reaproveitando o mesmo template para **Orçamento** e **OS**, mudando apenas o título (`Orçamento Nº` vs `Pedido / OS Nº`) e alguns campos contextuais.

## 1. Estrutura visual do PDF (A4 retrato)

Reproduzindo o layout do anexo:

```text
┌──────────────────────────────────────────────────────────┐
│ [LOGO]                       │  ▌ faixa roxa             │
│                              │  Pedido / Orçamento Nº    │
│                              │  Autorização  Liberação   │
│ "Slogan"                     │  Solicitação  Confirmação │
│ EMPRESA LTDA                 │  Produto                  │
│ CNPJ ...                     │  Agência / Vendedor       │
│ Telefones                    │  ─────────────            │
│ Endereço                     │  Cliente (Nome, CNPJ,     │
│                              │  Endereço, Cidade/UF/CEP) │
├──────────────────────────────────────────────────────────┤
│ Produtos | Descrição          Un | Qtd | V.Unit | V.Total│
│ 1484  IMPRESSÃO ...           UN   1    R$ ...   R$ ...  │
│       TAM:7,15X95CM/TESTEIRA       1    R$ ...   R$ ...  │
│       ...                                                │
│                              Total itens 12   R$ ...     │
├──────────────────────────────────────────────────────────┤
│                              ┌───────────────────────┐   │
│ Vencimento / Valor           │ Total Geral           │   │
│                              │ R$ 12.771,63          │   │
│                              └───────────────────────┘   │
├──────────────────────────────────────────────────────────┤
│ Observações / Condições (texto livre)                    │
│                                                          │
│ Autorizo em ___/___/___                                  │
│                                                          │
│ ____________________      ____________________           │
│ Vendedor (Empresa)        Cliente                        │
├──────────────────────────────────────────────────────────┤
│ rodapé: site             #1               data/hora      │
└──────────────────────────────────────────────────────────┘
```

**Paleta:** roxo/magenta como cor de marca (`--primary`), preto para texto, cinza para labels. Reaproveita os tokens do design system.

## 2. Dados que entram no PDF

**Orçamento** (`orcamentos` + `orcamento_itens` + `clientes` + `empresa_config`):
- Número, datas (solicitação = created_at, validade)
- Vendedor (perfil do criador)
- Cliente: nome, CNPJ/CPF, endereço completo
- Itens agrupados (código, descrição, sub-descrições com tamanhos, un, qtd, vlr unit, vlr total)
- Subtotal, descontos, total geral
- Condições de pagamento / vencimento
- Observações + assinaturas

**OS** (`ordens_servico` + itens + cliente):
- Mesmo template, título "Ordem de Serviço Nº"
- Inclui: prazo de entrega, prioridade, status, briefing
- Pode ocultar valores quando usuário não tem `canSeeFinancials` (versão "produção")

## 3. Implementação técnica

**Biblioteca:** `@react-pdf/renderer` (gera PDF no client, sem dependência de Node nativo — funciona no Worker e no browser). Alternativa: `pdfmake`. Vou usar `@react-pdf/renderer` por componentização React.

**Arquivos a criar:**
- `src/lib/pdf/DocumentoPDF.tsx` — componente `<Document>` reutilizável que recebe `{ tipo: "orcamento" | "os", header, cliente, itens, totais, observacoes }`
- `src/lib/pdf/generate.ts` — helper `gerarPDF(tipo, id)` que carrega dados do Supabase, monta o payload e dispara `pdf(<DocumentoPDF/>).toBlob()` + download
- `src/lib/pdf/empresa.ts` — config da empresa (nome, CNPJ, endereço, telefones, slogan, logo). Inicial: hardcoded com os dados do "Talento Digital" como placeholder, depois migrar para tabela `empresa_config`.

**Botões "Baixar PDF":**
- `src/routes/_authenticated/orcamentos.$id.tsx` — botão no header
- `src/routes/_authenticated/os.$id.tsx` — botão no header (2 variantes: "PDF Cliente" com valores / "PDF Produção" sem valores)

**Logo:** placeholder texto agora; depois usuário pode subir via Configurações → Storage.

## 4. Configurações da empresa (futuro próximo)

Sugerir criar uma tabela `empresa_config` (singleton) com:
- razao_social, nome_fantasia, cnpj, ie
- endereco, telefones, email, site
- slogan, logo_url, cor_primaria
- termos_padrao_orcamento, termos_padrao_os

Não entra agora — fica em backlog. Por ora os dados ficam num arquivo TS que o usuário edita.

## 5. Entregáveis desta rodada

1. Instalar `@react-pdf/renderer`
2. Criar `src/lib/pdf/DocumentoPDF.tsx` + `generate.ts` + `empresa.ts`
3. Adicionar botão "Baixar PDF" em **Orçamento detalhe** e **OS detalhe**
4. Testar visualmente abrindo um orçamento existente

## Perguntas antes de implementar

1. **Dados da sua empresa** (vão no cabeçalho): você pode me passar agora razão social, CNPJ, telefones, endereço e slogan? Ou começo com placeholders "Sua Empresa" para você editar depois?
2. **Logo:** quer subir agora (anexar PNG/SVG) ou deixo um espaço reservado?
3. **OS — duas versões de PDF?** Uma "Cliente" (com valores) e outra "Produção" (sem valores, só specs e prazo) — confirma?
