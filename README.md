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
