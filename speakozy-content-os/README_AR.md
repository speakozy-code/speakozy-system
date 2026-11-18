# Speakozy OS — مساحة المحتوى والإنجاز

تطبيق ويب عربي مستقل لتخطيط محتوى Speakozy ومهامه. يُبنى كملفات ثابتة باستخدام Vite، ويُنشر على **مشروع Firebase Hosting مستقل** حتى يظل منفصلًا عن استضافة نظام الأكاديمية.

## الوظائف

- لوحة يومية للمحتوى والمهام والتذكيرات.
- الأهداف والاستراتيجية، واستوديو محتوى قابل للبحث والتصنيف والنسخ والأرشفة.
- تقويم للمحتوى، ومهام وتذكيرات بتكرار اختياري.
- جرس إشعارات داخل الموقع يعرض التذكيرات المستحقة أثناء استخدام الموقع.
- مزامنة اختيارية عبر Firebase Authentication وCloud Firestore.
- تنزيل نسخة JSON من بيانات مساحة العمل.

الإشعارات داخل الموقع فقط: لا يرسل التطبيق بريدًا أو رسائل Telegram، ولا يستخدم إشعارات المتصفح أو وظائف مجدولة. يظهر جرس التذكير عند فتح الموقع، وتظل البيانات محفوظة في Firebase عند تسجيل الدخول. من دون إعداد Firebase، تُحفظ البيانات على الجهاز الحالي فقط.

## الإعداد والنشر من Google Cloud Shell

أنشئ مشروع Firebase مستقلًا لهذا النظام، ثم في Firebase Console:

1. أضف تطبيق ويب وانسخ إعدادات Firebase إلى ملف `.env` في جذر المشروع، وفق أسماء المتغيرات الموجودة في `.env.example`.
2. فعّل **Authentication → Email/Password** وأنشئ حساب الدخول.
3. أنشئ قاعدة **Cloud Firestore** في المشروع نفسه.
4. ارفع `speakozy-content-os-source.zip` إلى Cloud Shell ثم نفّذ:

```bash
mkdir -p speakozy-content-os
unzip speakozy-content-os-source.zip -d speakozy-content-os
cd speakozy-content-os
cp .env.example .env
nano .env
npm install
npm run build
npm install -g firebase-tools
firebase login --no-localhost
firebase use --add
firebase deploy --only hosting,firestore:rules
```

عند `firebase use --add` اختر مشروع Speakozy OS الجديد. ينشر الأمر ملفات الموقع وقواعد Firestore إلى Firebase Hosting في ذلك المشروع. لا تستخدم مشروع الأكاديمية.

من دون ملف `.env` صالح، يعمل الموقع محليًا للمعاينة، لكن تسجيل الدخول والمزامنة السحابية لا يعملان.
