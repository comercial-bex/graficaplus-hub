# Project architecture rules

- Theme roles belong in `src/styles.css`; shared and feature components consume semantic tokens so light and dark modes remain consistent.
- The application sidebar always uses the dark sidebar token set, independently of the selected content theme, because navigation must keep its established identity.
- Contextual help copy is centralized in `src/lib/dicas.ts`, while shared tooltip behavior lives in `src/components/bex/Dica.tsx`, so explanations remain consistent across mouse, keyboard, and touch.
- The official Bex Print logo for white backgrounds is `public/marca/bex-print-fundo-claro.png` (`LOGO_FUNDO_CLARO` in `src/lib/marca.ts`): use it on every Bex Print PDF and on white surfaces the client sees, always on a white plate; never on dark backgrounds (black letters), and never on partner documents, which carry the partner's own brand.
