# Deploy en Netlify

## 1) Conectar el repo
- Crea un sitio en Netlify desde este repositorio.
- Build command: vacio
- Publish directory: `.`

## 2) Variables de entorno (Site settings -> Environment variables)
- `OPENAI_API_KEY` = tu clave
- `OPENAI_MODEL` = `gpt-4.1-mini` (opcional)
- `RATE_LIMIT_PER_DAY` = `12` (opcional, para limitar analisis por cliente/dia)

## 3) Verificar config
Este proyecto ya incluye:
- `netlify.toml` con redirects de `/api/*`
- `netlify/functions/pera-analyze.mjs`
- `netlify/functions/health.mjs`

## 4) Probar
- Abre tu sitio desplegado.
- Debe mostrar "Backend IA conectado" junto al boton.
- Escribe contenido PERA y usa "Analizar con IA".

## 5) Si algo falla
- Revisa `Function logs` en Netlify.
- Verifica que `OPENAI_API_KEY` este definida y vuelve a hacer redeploy.
