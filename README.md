# ORO System - Realtime Gold Price System (نظام أسعار الذهب المباشر)

نظام إلكتروني متكامل لإدارة وعرض أسعار الذهب والعملات والمنتجات مع الربط المباشر مع أسواق الذهب العالمية وتزامن لحظي عبر Firebase Firestore.

---

## 🚀 تشغيل المشروع في Visual Studio / VS Code (Local Development)

لبتشغيل المشروع محلياً على جهازك:

1. افتح المجلد في **Visual Studio Code** أو **Visual Studio**.
2. افتح مبوب **Terminal** وقم بتثبيت الحزم:
   ```bash
   npm install
   ```
3. لتشغيل السيرفر الكامل (تزامن خادم Express + معينة Vite):
   ```bash
   npm run dev
   ```
   أو لتشغيل واجهة المستخدم فقط (Vite Standalone):
   ```bash
   npm run dev:client
   ```
4. افتح المتصفح على الرابط:
   `http://localhost:3000`

---

## 🌐 رفع المشروع على Netlify (Static Hosting)

المشروع مصمم ليعمل بسلاسة على Netlify وبدون الحاجة لإعدادات معقدة:

1. **إعدادات البناء (Build Settings في Netlify):**
   - **Build Command:** `npm run build` (أو `npm run build:client`)
   - **Publish directory:** `dist`
2. يحتوي المشروع على ملف `netlify.toml` معرف فيه توجيهات الصفحة الواحدة (`SPA Redirects`) لمنع مشاكل الـ 404 عند تحديث الصفحة.

---

## 🔗 ربط الدومين الخاص `orosystemprices.com`

لربط الدومين الخاص بك `https://orosystemprices.com` بالمشروع:

1. **في لوحة تحكم Netlify:**
   - اذهب إلى **Domain Management** -> **Add custom domain**.
   - أضف `orosystemprices.com` و `www.orosystemprices.com`.

2. **في لوحة تحكم مسجل الدومين (GoDaddy / Namecheap / Cloudflare / Google Domains):**
   - قم بإضافة **A Record**:
     - Host / Name: `@`
     - Value / Points to: `75.2.60.5` (عنوان IP الخاص بـ Netlify)
   - قم بإضافة **CNAME Record**:
     - Host / Name: `www`
     - Value / Points to: رابط موقعك في نيتليفاي (مثال: `oroperices.netlify.app`)

3. سيقوم Netlify بتفعيل شهادة الأمان **SSL (HTTPS)** مجاناً وتلقائياً خلال دقائق.

---

## 🛠️ تقنيات المشروع (Tech Stack)

- **React 19 & TypeScript**
- **Vite & Tailwind CSS v4**
- **Firebase Cloud Firestore** (Realtime database embedded)
- **Express.js & SSE** (Real-time events proxy)
- **Lucide Icons & Motion**
