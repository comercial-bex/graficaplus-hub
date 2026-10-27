UPDATE public.arquivos SET mime_type = CASE
  WHEN caminho ~* '\.png$' THEN 'image/png'
  WHEN caminho ~* '\.jpe?g$' THEN 'image/jpeg'
  WHEN caminho ~* '\.webp$' THEN 'image/webp'
  WHEN caminho ~* '\.pdf$' THEN 'application/pdf' END
WHERE mime_type IS NULL AND caminho ~* '\.(png|jpe?g|webp|pdf)$';