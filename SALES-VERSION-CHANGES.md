# تغييرات نسخة المناديب v19

1. الصفحات المتاحة: الداش بورد وإضافة العملاء فقط.
2. روابط أي صفحة أخرى تعود تلقائياً إلى الداش بورد.
3. إعدادات النظام تظل للقراءة من نسخة الويب/Firestore.
4. البيانات المخزنة محلياً تستخدم للعرض السريع عند Refresh فقط، ثم يتم استبدالها بالبيانات الحديثة من السيرفر.
5. تم حذف ملف أدوات استيراد البيانات الإداري من هذه النسخة.


## v20
- Changed the quick chat status label from `الحالة` to `اختيار الحالة`.
- Increased the label visibility for sales agents.
- No Firebase, status update, or CRM logic was changed.

## v21 - فتح المحادثة عند آخر رسالة
- عند فتح محادثة أي عميل، يتم الانتقال تلقائيًا إلى أحدث رسالة في أسفل الشات.
- ينتظر تحميل الرسائل والصور والوسائط قبل تثبيت موضع العرض في الأسفل.
- إذا صعد المندوب لقراءة رسائل قديمة، لا يتم سحبه إلى الأسفل تلقائيًا.
- عند وصول أو إرسال رسالة جديدة أثناء وجوده عند آخر الشات، يتم إبقاؤه عند أحدث رسالة.
- لم يتم تعديل Firebase أو الحالات أو إرسال الرسائل أو بيانات العملاء.


## v22
- Made the quick status instruction permanently visible on mobile.
- Changed the label to `اختيار الحالة من هنا`.
- Added a highlighted status box and arrow without changing status logic.

## v23 - Compact status selector on phones
- Shortened the quick label to `اختيار الحالة`.
- Kept the selector beside the customer name on phones.
- Reduced its padding, height, font size, border, and shadow.
- No status or Firebase logic was changed.
