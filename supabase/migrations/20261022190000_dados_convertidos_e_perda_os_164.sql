-- Registro de dados (22/10/2026), decisões do dono.
--
-- 1. Os 9 orçamentos que já viraram OS e continuavam "aprovado" (nasceram antes
--    de converter_orcamento_em_os gravar "convertido") passam a "convertido". O
--    funil e o faturamento previsto passam a contar certo. Ensaio: 0 aviso.
-- 2. OS #164: a baixa de 1,0 m² (sugestão sem a área, corrigida em #166) deixou
--    0,955 m² de lona reservados para sempre. O dono decidiu: entra como PERDA.
--    O gatilho de os_perdas lança o custo na OS, a saída de estoque e a baixa do
--    lote; aqui só se libera a reserva presa. Ensaio: lote 4,000 → 3,045 m²,
--    reserva 0, R$ 9,07 de perda no custo real da #164.

UPDATE public.orcamentos SET status = 'convertido'
 WHERE os_id IS NOT NULL AND status = 'aprovado'
   AND numero IN (55, 61, 67, 71, 73, 75, 78, 98, 108);

INSERT INTO public.os_perdas (os_id, material_id, quantidade_perdida, unidade, motivo, observacoes)
SELECT o.id, '9df570b3-b465-43fe-a446-28eb6e971b1e', 0.955, 'm²', 'outro',
       'Resto da reserva da OS #164 preso pela baixa de 1,0 m² (sugestão sem a área, corrigida em 22/10). Lançado como perda por decisão do dono.'
  FROM public.ordens_servico o
 WHERE o.numero = 164
   AND NOT EXISTS (SELECT 1 FROM public.os_perdas p WHERE p.os_id = o.id AND p.material_id = '9df570b3-b465-43fe-a446-28eb6e971b1e');

UPDATE public.estoque_reservas SET quantidade_baixada = quantidade, status = 'baixada'
 WHERE id = '0a0ebd01-b3ad-45ed-ad42-7bdd35e9fcbc' AND status = 'parcial';

UPDATE public.material_lotes SET quantidade_reservada = greatest(quantidade_reservada - 0.955, 0)
 WHERE id = '38b0b37c-38ad-48ba-8633-cb5b978daedc' AND quantidade_reservada >= 0.955;
