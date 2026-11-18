# Aula Virtual

Aplicación web para subir tus clases (PowerPoint → HTML), organizarlas en **Materias → Capítulos → Módulos** con **quiz al final de cada capítulo**, y darles acceso a tus estudiantes con correo y contraseña.

- Sitio estático (HTML + JS puro, sin compilar) → se publica directo en **Netlify desde GitHub**.
- Base de datos, login e imágenes en **Supabase** (plan gratuito).
- El PowerPoint se convierte **en tu navegador** al subirlo; no necesitas instalar nada.

## 1. Supabase (una sola vez)
1. Crea un proyecto en https://supabase.com.
2. **SQL Editor → New query**: pega todo `supabase/schema.sql` y pulsa **Run**.
3. **Project Settings → API**: copia *Project URL* y *anon public key* y pégalos en `js/config.js`.
4. **Authentication → Providers → Email**: si quieres que los estudiantes entren sin confirmar correo, desactiva *Confirm email*.
5. **Authentication → URL Configuration**: en *Site URL* pon la dirección final (p. ej. `https://aula.tudominio.com`).

## 2. GitHub
```
git init && git add . && git commit -m "Aula Virtual"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/aula-virtual.git
git push -u origin main
```

## 3. Netlify + subdominio
1. Netlify → **Add new site → Import from Git** → elige el repositorio. Build command: vacío. Publish directory: `.`
2. **Domain management → Add a domain** → `aula.tudominio.com` y crea en tu DNS el registro CNAME que Netlify indique.
3. Cada `git push` vuelve a publicar. (El contenido de las clases NO se sube por git: vive en Supabase, así que subir clases no requiere publicar de nuevo.)

## 4. Primer uso
1. Abre la web y **crea tu cuenta**.
2. En Supabase → SQL Editor ejecuta (con tu correo):
   `update public.profiles set role = 'admin' where email = 'tu@correo.com';`
3. Recarga: aparece **Administración**.
4. **Materias → Nueva materia →** agrega capítulos → **Subir PowerPoint** (puedes seleccionar varios .pptx; cada uno es un módulo) → **Crear quiz**.
5. Marca la materia como **Publicada**.
6. Tus estudiantes se registran solos; en **Estudiantes y notas** marcas a qué materias tienen acceso y ves sus notas.

## Notas y límites
- Solo `.pptx` (si tienes `.ppt`, guárdalo como `.pptx` en PowerPoint).
- El conversor reproduce texto, viñetas, imágenes, formas, tablas, fondos y logos del patrón. **No convierte** gráficos de datos, SmartArt, animaciones, videos ni audio (aparece un recuadro gris). Revisa cada módulo con "Ver" después de subirlo; si algo sale mal, exporta esa diapositiva como imagen en PowerPoint.
- Las imágenes quedan en un bucket público con nombres aleatorios (no listables); el texto de las clases y los quices solo lo leen estudiantes matriculados.
- Las respuestas correctas de los quices viajan al navegador del estudiante (se corrige en el cliente). Es adecuado para práctica, no para exámenes de alto riesgo.
- Para reemplazar un PowerPoint actualizado usa **Reemplazar PPT** (conserva el orden y el progreso).

## Quices con IA
En **Administración → Editar materia → Crear/Editar quiz** hay una tarjeta "✨ Generar preguntas con IA". Siempre revisa las preguntas antes de **Guardar quiz**.

**A) Automático (función de Netlify + API de Anthropic)**
1. Crea una API key en https://console.anthropic.com (es de pago por uso, aparte de tu suscripción a Claude).
2. En Netlify → Site configuration → Environment variables agrega `ANTHROPIC_API_KEY` (secreta). Opcional: `ANTHROPIC_MODEL` (por defecto `claude-haiku-5-5`).
3. Haz `git push` (la función vive en `netlify/functions/generate-quiz.js`) y pulsa **Generar automáticamente**.
- Solo el administrador puede usarla. Lee el texto de las diapositivas y, si una diapositiva es casi solo imagen (típico de Canva), le envía la imagen a la IA (máximo 20 imágenes por capítulo).

**B) Sin costo extra (con Claude en el chat)**
1. Pulsa **Copiar prompt para Claude**, pégalo en un chat de Claude y **adjunta el/los .pptx** (necesario si tus diapositivas son imágenes).
2. Copia el arreglo JSON que te devuelva y pulsa **Importar preguntas (JSON)**.

## Notas y audio por diapositiva
- Las notas del PowerPoint o del paquete .zip se importan al subir la clase (la app pregunta si se muestran a los estudiantes).
- El administrador puede, en cualquier diapositiva, escribir o editar las notas y grabar o subir un audio (panel «Notas y audio de esta diapositiva», debajo de la diapositiva). No requiere cambios en Supabase: se guardan en la misma columna `slides` y el audio en el bucket `class-media`.
- «Reemplazar PPT» crea de nuevo las diapositivas: las notas escritas a mano y los audios de ese módulo se pierden.

## Notas automáticas con IA y voz con ElevenLabs
En el editor de cada diapositiva (solo administrador):
- **✨ Generar notas con IA**: Claude redacta un guion de ~90 palabras a partir del contenido de la diapositiva (si es una imagen sin texto, la lee). Se carga en el cuadro de notas: lo revisas, lo editas y pulsas *Guardar notas*.
- **🔊 Voz con ElevenLabs**: convierte el texto del cuadro de notas en un MP3; lo escuchas y pulsas *Guardar este audio* (o lo descartas).
- **Todo el módulo**: *Generar notas faltantes* (solo las que están vacías) y *Generar audios faltantes* (las que tienen notas y no tienen audio; avisa los caracteres que consumirá). Grabar tu propia voz o subir un archivo sigue funcionando igual.

Configuración en Netlify → Site configuration → Environment variables:
| Variable | Para qué |
|---|---|
| `ANTHROPIC_API_KEY` | notas con IA (la misma de los quices) |
| `ELEVENLABS_API_KEY` | voz (secreta; nunca va en el navegador) |
| `ELEVENLABS_VOICE_ID` | la voz a usar (ID de ElevenLabs → Voices) |
| `ELEVENLABS_MODEL` | opcional; por defecto `eleven_multilingual_v2` |

Después de agregar las variables, haz un nuevo deploy. Las funciones son `netlify/functions/generate-notes.js` y `tts.js`; ambas verifican que quien llama sea administrador. Cada audio admite hasta 4 000 caracteres.
