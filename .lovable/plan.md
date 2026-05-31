# Ajustes no Sistema de PDF (Orçamento e OS)

## 1. Template PDF fiel ao layout Talento Digital

Refinar `src/lib/pdf/DocumentoPDF.tsx`:
- Header: barra roxa superior fina + bloco com logo placeholder à esquerda, dados da empresa (razão social, CNPJ, IE, endereço, telefones, site) à direita, alinhado em colunas.
- Título do documento (PEDIDO / ORÇAMENTO / ORDEM DE SERVIÇO Nº xxxxx) destacado, fundo cinza claro.
- Bloco meta (2 colunas): Solicitação, Validade, Vendedor, Status / Entrega prevista, Forma pagamento, Condição.
- Bloco "DADOS DO CLIENTE" com label cinza e campos (Razão social, CNPJ/CPF, IE, Endereço completo, Cidade/UF, Telefone, Email, Contato).
- Tabela de itens: cabeçalho roxo com texto branco, colunas Cód | Descrição | Tamanho | Un | Qtd | Vlr Unit | Vlr Total. Linhas zebradas. Quebra de página automática repetindo cabeçalho (`fixed` em TableHeader).
- Linha de subtotal + box "TOTAL GERAL" destacado à direita.
- Observações em caixa com borda.
- Rodapé fixo (`fixed`): linha de assinatura cliente, data, número de página "Página X de Y".
- Versão "Produção" oculta colunas de valor e total geral.

## 2. Salvar PDF no Supabase Storage

- Criar bucket `documentos-pdf` (privado) via migração.
- RLS: staff pode SELECT/INSERT objetos no bucket.
- Criar tabela `documentos_gerados`:
  - tipo (orcamento|os), referencia_id (uuid), variante (cliente|producao), numero (int),
  - caminho (text), tamanho_bytes (bigint), gerado_por (uuid), created_at.
- RLS: staff read; staff insert.
- Adaptar `generate.ts`:
  - Após `pdf().toBlob()`, fazer upload para `documentos-pdf/{tipo}/{numero}-{variante}-{timestamp}.pdf`.
  - Inserir registro em `documentos_gerados`.
  - Retornar `{ blob, url, registro }`.
  - Continuar disparando o download local.

## 3. Histórico de PDFs nas páginas

Em `orcamentos.$id.tsx` e `os.$id.tsx`:
- Query `documentos_gerados` filtrada por tipo + referencia_id, ordenada desc.
- Card "Histórico de PDFs" listando data/hora, variante, usuário, com botões Visualizar e Baixar (URL assinada via `storage.createSignedUrl`).
- Invalidar query ao gerar novo PDF.

## 4. Preview antes do download

- Novo componente `src/lib/pdf/PDFPreviewDialog.tsx`:
  - Dialog (shadcn) tamanho grande.
  - Usa `<PDFViewer>` do `@react-pdf/renderer` para renderizar o `<DocumentoPDF>` inline.
  - Botões: "Baixar PDF" (salva no storage + download), "Fechar".
- Substituir os botões diretos em orcamentos/os por botões que abrem o preview.
- Para OS, dois botões (Cliente/Produção) abrindo o preview com a variante.

## 5. Verificação SSR

- `PDFViewer` usa `iframe` (client-only): garantir import dinâmico + render apenas após `mounted` (useEffect) para não quebrar SSR.
- Rodar `bun run build` ao final e revisar logs para confirmar zero erros de prerender em todas as rotas.

## Detalhes técnicos

- Bucket privado + URLs assinadas (1h) ao listar histórico.
- `@react-pdf/renderer` `<PDFViewer>` deve estar atrás de `dynamic import` + flag `typeof window !== 'undefined'` para evitar quebra no SSR do dialog.
- Numeração de página: usar `render={({ pageNumber, totalPages }) => ...}` em Text fixed.
- Migração separada para tabela + bucket.

## Arquivos

Criar:
- `src/lib/pdf/PDFPreviewDialog.tsx`
- Migração SQL (bucket + tabela)

Editar:
- `src/lib/pdf/DocumentoPDF.tsx` (layout refinado)
- `src/lib/pdf/generate.ts` (upload + registro + retorno)
- `src/routes/_authenticated/orcamentos.$id.tsx` (preview + histórico)
- `src/routes/_authenticated/os.$id.tsx` (preview + histórico)
