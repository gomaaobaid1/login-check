// ===== نظام الإشعارات المتكامل =====

// تخزين الإشعارات المحلي
let allNotifications = [];
let notificationSettings = {
  enabledNotifications: true,
  enableSound: true,
  enableOverdueReminders: true,
  reminderFrequency: 'daily', // daily, every3days, weekly
  notificationTypes: {
    orderStatus: true,
    paymentReminder: true,
    invoiceCreated: true,
    paymentReceived: true,
    systemAnnouncements: true
  }
};

// ===== إرسال إشعار للعميل =====
async function sendNotificationToUser(userId, notificationData) {
  try {
    const notification = {
      id: Date.now(),
      user_id: userId,
      type: notificationData.type,
      title: notificationData.title,
      message: notificationData.message,
      icon: notificationData.icon || 'fas fa-bell',
      color: notificationData.color || '#2563eb',
      action_url: notificationData.action_url || null,
      is_read: false,
      is_sent_to_device: false,
      created_at: new Date().toISOString(),
      expires_at: notificationData.expires_at || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    };

    // حفظ في قاعدة البيانات
    const { error } = await sb.from('notifications').insert([notification]);
    if (error) throw error;

    // إذا كان المستخدم متصل الآن، عرض الإشعار فوراً
    if (currentUser && currentUser.id === userId) {
      showNotificationToUser(notification);
    }

    return notification;
  } catch(err) {
    console.error('Error sending notification:', err);
  }
}

// ===== عرض الإشعار على الشاشة =====
function showNotificationToUser(notification) {
  const container = document.getElementById('notificationsContainer') || createNotificationsContainer();
  
  const notifEl = document.createElement('div');
  notifEl.className = 'notification-toast';
  notifEl.style.cssText = `
    position: fixed;
    top: 100px;
    right: 20px;
    background: white;
    border-radius: 12px;
    box-shadow: 0 10px 40px rgba(0,0,0,0.15);
    padding: 16px 20px;
    max-width: 400px;
    z-index: 9999;
    animation: slideInRight 0.4s ease;
    border-right: 4px solid ${notification.color};
  `;

  notifEl.innerHTML = `
    <div style="display: flex; gap: 12px; align-items: flex-start;">
      <i class="${notification.icon}" style="font-size: 1.25rem; color: ${notification.color}; flex-shrink: 0; margin-top: 3px;"></i>
      <div style="flex: 1; min-width: 0;">
        <h4 style="margin: 0 0 4px; color: var(--dark); font-weight: 700;">${notification.title}</h4>
        <p style="margin: 0; color: var(--gray); font-size: 0.9rem; line-height: 1.5;">${notification.message}</p>
        ${notification.action_url ? `<a href="${notification.action_url}" onclick="event.preventDefault(); navLinkClick('${notification.action_url}'); this.closest('.notification-toast').remove();" style="color: var(--primary); font-size: 0.85rem; text-decoration: none; font-weight: 600; display: inline-block; margin-top: 8px;"><i class="fas fa-arrow-left"></i> اذهب الآن</a>` : ''}
      </div>
      <button onclick="this.closest('.notification-toast').remove()" style="background: none; border: none; color: var(--gray); font-size: 1.2rem; cursor: pointer; padding: 0; flex-shrink: 0;">×</button>
    </div>
  `;

  container.appendChild(notifEl);

  // تشغيل صوت إذا كان مفعل
  if (notificationSettings.enableSound) {
    playNotificationSound();
  }

  // حفظ الإشعار
  allNotifications.unshift(notification);
  localStorage.setItem('obied_notifications', JSON.stringify(allNotifications.slice(0, 100)));

  // إزالة تلقائية بعد 8 ثوانٍ
  setTimeout(() => {
    notifEl.style.animation = 'slideOutRight 0.3s ease forwards';
    setTimeout(() => notifEl.remove(), 300);
  }, 8000);
}

// ===== تشغيل صوت الإشعار =====
function playNotificationSound() {
  try {
    // صوت بسيط باستخدام Web Audio API
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
    oscillator.frequency.setValueAtTime(600, audioContext.currentTime + 0.1);
    
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.setValueAtTime(0, audioContext.currentTime + 0.1);
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.1);
  } catch(e) {
    // تجاهل الخطأ
  }
}

// ===== إنشاء حاوية الإشعارات =====
function createNotificationsContainer() {
  const container = document.createElement('div');
  container.id = 'notificationsContainer';
  document.body.appendChild(container);
  return container;
}

// ===== إرسال تذكير الدفع المتأخر =====
async function sendOverduePaymentReminders() {
  if (!currentAdmin) return;

  try {
    const { data: overdueInvoices } = await sb.from('invoices')
      .select('id, user_id, customer_name, invoice_number, total, status, created_at, due_date')
      .in('status', ['pending_payment', 'overdue', 'awaiting_payment'])
      .order('created_at', { ascending: true });

    if (!overdueInvoices || overdueInvoices.length === 0) {
      showAlert('✅ لا توجد فواتير متأخرة عن الدفع', 'success', 3000);
      return;
    }

    const now = new Date();
    let remindersSent = 0;
    const reminderLog = [];

    for (const invoice of overdueInvoices) {
      const createdDate = new Date(invoice.created_at);
      const daysOverdue = Math.floor((now - createdDate) / (1000 * 60 * 60 * 24));
      
      // إرسال تذكير إذا تأخر أكثر من يوم واحد
      if (daysOverdue >= 1) {
        const lastReminder = localStorage.getItem(`obied_reminder_${invoice.id}`);
        const shouldSend = !lastReminder || (Date.now() - parseInt(lastReminder)) > 24 * 60 * 60 * 1000;

        if (shouldSend) {
          const message = daysOverdue >= 3 
            ? `⚠️ عاجل: الفاتورة #${invoice.invoice_number} متأخرة ${daysOverdue} أيام! يرجى تسديد المبلغ ${invoice.total} ل.س فوراً.`
            : `📌 تذكير: الفاتورة #${invoice.invoice_number} بانتظار الدفع. المبلغ: ${invoice.total} ل.س`;

          await sendNotificationToUser(invoice.user_id, {
            type: 'paymentReminder',
            title: daysOverdue >= 3 ? '⚠️ فاتورة متأخرة عاجلة!' : '📌 تذكير دفع',
            message: message,
            icon: daysOverdue >= 3 ? 'fas fa-exclamation-circle' : 'fas fa-clock',
            color: daysOverdue >= 3 ? '#ef4444' : '#f59e0b',
            action_url: 'invoices'
          });

          localStorage.setItem(`obied_reminder_${invoice.id}`, String(Date.now()));
          remindersSent++;
          reminderLog.push({
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoice_number,
            customerName: invoice.customer_name,
            daysOverdue: daysOverdue,
            amount: invoice.total
          });
        }
      }
    }

    if (remindersSent > 0) {
      showOverdueRemindersLog(reminderLog);
      showAlert(`✅ تم إرسال ${remindersSent} تذكير دفع`, 'success', 3000);
    } else {
      showAlert('✅ جميع التذكيرات محدثة', 'success', 3000);
    }

  } catch(err) {
    console.error('Error sending reminders:', err);
    showAlert('❌ خطأ في إرسال التذكيرات', 'danger', 3000);
  }
}

// ===== عرض سجل التذكيرات =====
function showOverdueRemindersLog(log) {
  const modal = `
    <div style="padding: 0; max-width: 700px; width: 100%;">
      <div style="background: linear-gradient(135deg, #f59e0b, #d97706); color: white; padding: 20px 25px; border-radius: 12px 12px 0 0;">
        <h3 style="margin: 0;"><i class="fas fa-bell"></i> سجل التذكيرات المرسلة</h3>
        <p style="margin: 8px 0 0; opacity: 0.9;">${log.length} تذكير تم إرساله بنجاح</p>
      </div>
      <div style="background: white; padding: 20px; max-height: 60vh; overflow-y: auto;">
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0;">
              <th style="padding: 12px; text-align: right; font-weight: 700; color: var(--dark);">العميل</th>
              <th style="padding: 12px; text-align: right; font-weight: 700; color: var(--dark);">الفاتورة</th>
              <th style="padding: 12px; text-align: right; font-weight: 700; color: var(--dark);">المبلغ</th>
              <th style="padding: 12px; text-align: right; font-weight: 700; color: var(--dark);">التأخير</th>
            </tr>
          </thead>
          <tbody>
            ${log.map(item => `
              <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 12px; color: var(--dark);">${item.customerName}</td>
                <td style="padding: 12px; color: var(--primary); font-weight: 600;">${item.invoiceNumber}</td>
                <td style="padding: 12px; color: var(--dark);">${item.amount?.toFixed(2)} ل.س</td>
                <td style="padding: 12px;">
                  <span style="background: ${item.daysOverdue >= 3 ? '#fecaca' : '#fef3c7'}; color: ${item.daysOverdue >= 3 ? '#dc2626' : '#d97706'}; padding: 4px 12px; border-radius: 50px; font-size: 0.85rem; font-weight: 600;">
                    ${item.daysOverdue} يوم
                  </span>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <div style="padding: 15px; border-top: 1px solid #e2e8f0; display: flex; justify-content: center; gap: 10px;">
        <button class="btn-primary" onclick="closeModal()" style="padding: 10px 25px;"><i class="fas fa-check"></i> تم</button>
      </div>
    </div>`;

  showModal(modal);
}

// ===== إرسال إشعار للعملاء عند تحديث حالة الطلب =====
async function notifyOrderStatusChange(orderId, newStatus, orderData) {
  const statusMessages = {
    pending: { title: '⏳ الطلب في الانتظار', message: 'تم استلام طلبك وقيد المراجعة', icon: 'fas fa-clock', color: '#f59e0b' },
    'in-progress': { title: '🔧 الطلب قيد التنفيذ', message: 'بدأ فريقنا العمل على طلبك الآن', icon: 'fas fa-tools', color: '#3b82f6' },
    completed: { title: '✅ الطلب مكتمل', message: 'تم إكمال الخدمة بنجاح. شكراً لك!', icon: 'fas fa-check-circle', color: '#10b981' },
    cancelled: { title: '❌ الطلب ملغى', message: 'تم إلغاء الطلب. يرجى التواصل معنا للمزيد من المعلومات', icon: 'fas fa-times-circle', color: '#ef4444' }
  };

  const statusInfo = statusMessages[newStatus];
  if (statusInfo && orderData?.user_id) {
    await sendNotificationToUser(orderData.user_id, {
      type: 'orderStatus',
      title: statusInfo.title,
      message: statusInfo.message,
      icon: statusInfo.icon,
      color: statusInfo.color,
      action_url: 'profile'
    });
  }
}

// ===== إشعار بإنشاء فاتورة جديدة =====
async function notifyInvoiceCreated(userId, invoiceData) {
  await sendNotificationToUser(userId, {
    type: 'invoiceCreated',
    title: '📄 فاتورة جديدة',
    message: `تم إنشاء فاتورة جديدة برقم #${invoiceData.invoice_number} بمبلغ ${invoiceData.total} ل.س`,
    icon: 'fas fa-file-invoice',
    color: '#8b5cf6',
    action_url: 'invoices'
  });
}

// ===== إشعار بتسديد الدفع =====
async function notifyPaymentReceived(userId, invoiceData) {
  await sendNotificationToUser(userId, {
    type: 'paymentReceived',
    title: '✅ تم استقبال الدفع',
    message: `شكراً! تم تأكيد دفع الفاتورة #${invoiceData.invoice_number}. السلام عليكم.`,
    icon: 'fas fa-check-circle',
    color: '#10b981',
    action_url: 'invoices'
  });
}

// ===== لوحة التحكم بالإشعارات للأدمن =====
function showNotificationsControlPanel() {
  if (!currentAdmin) {
    showAlert('❌ ليس لديك صلاحيات كافية', 'danger', 3000);
    return;
  }

  const panel = `
    <div style="padding: 0; max-width: 900px; width: 100%;">
      <div style="background: linear-gradient(135deg, #8b5cf6, #6d28d9); color: white; padding: 25px; border-radius: 12px 12px 0 0;">
        <h2 style="margin: 0; display: flex; align-items: center; gap: 12px;"><i class="fas fa-bell"></i> لوحة تحكم ا��إشعارات</h2>
        <p style="margin: 8px 0 0; opacity: 0.9;">إدارة الإشعارات والتذكيرات التلقائية</p>
      </div>
      <div style="background: white; padding: 25px; max-height: 70vh; overflow-y: auto;">
        
        <!-- قسم الإشعارات السريعة -->
        <div style="background: #f8fafc; padding: 20px; border-radius: 12px; margin-bottom: 20px; border-right: 4px solid #8b5cf6;">
          <h3 style="margin: 0 0 15px; color: var(--dark);">🚀 إجراءات سريعة</h3>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px;">
            <button onclick="sendOverduePaymentReminders(); closeModal();" style="background: linear-gradient(135deg, #f59e0b, #d97706); color: white; border: none; padding: 12px 20px; border-radius: 8px; cursor: pointer; font-weight: 600; display: flex; align-items: center; gap: 8px; transition: all 0.3s;">
              <i class="fas fa-exclamation-circle"></i> إرسال تذكيرات متأخرة
            </button>
            <button onclick="broadcastSystemAnnouncement(); closeModal();" style="background: linear-gradient(135deg, #3b82f6, #2563eb); color: white; border: none; padding: 12px 20px; border-radius: 8px; cursor: pointer; font-weight: 600; display: flex; align-items: center; gap: 8px; transition: all 0.3s;">
              <i class="fas fa-megaphone"></i> إعلان عام
            </button>
            <button onclick="sendMaintenanceNotice(); closeModal();" style="background: linear-gradient(135deg, #ef4444, #dc2626); color: white; border: none; padding: 12px 20px; border-radius: 8px; cursor: pointer; font-weight: 600; display: flex; align-items: center; gap: 8px; transition: all 0.3s;">
              <i class="fas fa-tools"></i> إخطار صيانة
            </button>
          </div>
        </div>

        <!-- الإحصائيات -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 20px;">
          <div style="background: #e0f2fe; padding: 15px; border-radius: 8px; border-right: 4px solid #0284c7;">
            <div style="font-size: 1.75rem; font-weight: 800; color: #0284c7;" id="totalNotificationsSent">0</div>
            <div style="color: #0c4a6e; font-size: 0.9rem; margin-top: 5px;">إجمالي الإشعارات المرسلة</div>
          </div>
          <div style="background: #fef3c7; padding: 15px; border-radius: 8px; border-right: 4px solid #f59e0b;">
            <div style="font-size: 1.75rem; font-weight: 800; color: #f59e0b;" id="pendingNotifications">0</div>
            <div style="color: #a16207; font-size: 0.9rem; margin-top: 5px;">تذكيرات قيد الانتظار</div>
          </div>
          <div style="background: #d1fae5; padding: 15px; border-radius: 8px; border-right: 4px solid #10b981;">
            <div style="font-size: 1.75rem; font-weight: 800; color: #10b981;" id="readNotifications">0</div>
            <div style="color: #065f46; font-size: 0.9rem; margin-top: 5px;">إشعارات مقروءة</div>
          </div>
        </div>

        <!-- الإعدادات -->
        <div style="background: #f8fafc; padding: 20px; border-radius: 12px; border-right: 4px solid #8b5cf6;">
          <h3 style="margin: 0 0 15px; color: var(--dark);">⚙️ إعدادات الإشعارات</h3>
          <div style="display: flex; flex-direction: column; gap: 12px;">
            <label style="display: flex; align-items: center; gap: 12px; cursor: pointer;">
              <input type="checkbox" ${notificationSettings.enableSound ? 'checked' : ''} onchange="notificationSettings.enableSound = this.checked; localStorage.setItem('obied_notification_settings', JSON.stringify(notificationSettings));" style="width: 18px; height: 18px; cursor: pointer;">
              <span style="color: var(--dark);">تفعيل أصوات الإشعارات</span>
            </label>
            <label style="display: flex; align-items: center; gap: 12px; cursor: pointer;">
              <input type="checkbox" ${notificationSettings.enableOverdueReminders ? 'checked' : ''} onchange="notificationSettings.enableOverdueReminders = this.checked; localStorage.setItem('obied_notification_settings', JSON.stringify(notificationSettings));" style="width: 18px; height: 18px; cursor: pointer;">
              <span style="color: var(--dark);">تفعيل تذكيرات الدفع المتأخر</span>
            </label>
            <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #e2e8f0;">
              <label style="display: block; color: var(--dark); font-weight: 600; margin-bottom: 8px;">تكرار التذكيرات:</label>
              <select onchange="notificationSettings.reminderFrequency = this.value; localStorage.setItem('obied_notification_settings', JSON.stringify(notificationSettings));" style="width: 100%; padding: 10px; border: 2px solid #e2e8f0; border-radius: 8px; background: white; font-family: inherit;">
                <option value="daily" ${notificationSettings.reminderFrequency === 'daily' ? 'selected' : ''}>يومي</option>
                <option value="every3days" ${notificationSettings.reminderFrequency === 'every3days' ? 'selected' : ''}>كل 3 أيام</option>
                <option value="weekly" ${notificationSettings.reminderFrequency === 'weekly' ? 'selected' : ''}>أسبوعي</option>
              </select>
            </div>
          </div>
        </div>

      </div>
      <div style="padding: 15px 25px; border-top: 1px solid #e2e8f0; display: flex; justify-content: center; gap: 10px;">
        <button class="btn-primary" onclick="updateNotificationStats(); closeModal();" style="padding: 10px 25px; background: linear-gradient(135deg, #8b5cf6, #6d28d9);"><i class="fas fa-sync-alt"></i> تحديث</button>
        <button class="btn-primary" onclick="closeModal()" style="padding: 10px 25px;"><i class="fas fa-times"></i> إغلاق</button>
      </div>
    </div>`;

  showModal(panel);
  updateNotificationStats();
}

// ===== تحديث إحصائيات الإشعارات =====
async function updateNotificationStats() {
  try {
    const { data: sent } = await sb.from('notifications').select('id', { count: 'exact' });
    const { data: pending } = await sb.from('invoices').select('id', { count: 'exact' }).in('status', ['pending_payment', 'overdue']);
    const { data: read } = await sb.from('notifications').select('id', { count: 'exact' }).eq('is_read', true);

    document.getElementById('totalNotificationsSent').textContent = sent?.length || 0;
    document.getElementById('pendingNotifications').textContent = pending?.length || 0;
    document.getElementById('readNotifications').textContent = read?.length || 0;
  } catch(err) {
    console.error('Error updating notification stats:', err);
  }
}

// ===== إعلان عام للجميع =====
async function broadcastSystemAnnouncement() {
  const announcement = prompt('أدخل الإعلان العام:', 'شكراً لاستخدامك خدماتنا');
  if (!announcement) return;

  try {
    const { data: allUsers } = await sb.from('users').select('id');
    let sent = 0;

    for (const user of allUsers || []) {
      await sendNotificationToUser(user.id, {
        type: 'systemAnnouncements',
        title: '📢 إعلان عام',
        message: announcement,
        icon: 'fas fa-megaphone',
        color: '#3b82f6'
      });
      sent++;
    }

    showAlert(`✅ تم إرسال الإعلان لـ ${sent} مستخدم`, 'success', 3000);
  } catch(err) {
    console.error('Error broadcasting:', err);
  }
}

// ===== إخطار الصيانة المجدولة =====
async function sendMaintenanceNotice() {
  const maintenanceTime = prompt('أدخل وقت الصيانة (مثال: غداً الساعة 2 صباحاً):', 'غداً من 2:00 إلى 4:00 صباحاً');
  if (!maintenanceTime) return;

  try {
    const { data: allUsers } = await sb.from('users').select('id');
    let sent = 0;

    for (const user of allUsers || []) {
      await sendNotificationToUser(user.id, {
        type: 'systemAnnouncements',
        title: '🔧 إخطار صيانة مجدولة',
        message: `سيتم إجراء صيانة دورية على النظام: ${maintenanceTime}. قد تواجه تأخيراً في الخدمة.`,
        icon: 'fas fa-tools',
        color: '#ef4444'
      });
      sent++;
    }

    showAlert(`✅ تم إرسال إخطار الصيانة لـ ${sent} مستخدم`, 'success', 3000);
  } catch(err) {
    console.error('Error sending maintenance notice:', err);
  }
}

// ===== تحميل الإشعارات المحفوظة =====
function loadNotificationSettings() {
  const saved = localStorage.getItem('obied_notification_settings');
  if (saved) {
    notificationSettings = { ...notificationSettings, ...JSON.parse(saved) };
  }
  const savedNotifs = localStorage.getItem('obied_notifications');
  if (savedNotifs) {
    allNotifications = JSON.parse(savedNotifs);
  }
}

// ===== عرض مركز الإشعارات للعميل =====
function showNotificationCenter() {
  if (!currentUser) {
    showAlert('يرجى تسجيل الدخول أولاً', 'warning', 3000);
    return;
  }

  const panel = `
    <div style="padding: 0; max-width: 600px; width: 100%;">
      <div style="background: linear-gradient(135deg, #8b5cf6, #6d28d9); color: white; padding: 20px 25px; border-radius: 12px 12px 0 0;">
        <h2 style="margin: 0; display: flex; align-items: center; gap: 12px;"><i class="fas fa-bell"></i> مركز الإشعارات</h2>
      </div>
      <div style="background: white; max-height: 60vh; overflow-y: auto;">
        ${allNotifications.filter(n => n.user_id === currentUser.id).length === 0 ? `
          <div style="text-align: center; padding: 40px 20px; color: var(--gray);">
            <i class="fas fa-bell-slash" style="font-size: 3rem; margin-bottom: 15px; opacity: 0.3;"></i>
            <p>لا توجد إشعارات</p>
          </div>
        ` : `
          ${allNotifications.filter(n => n.user_id === currentUser.id).map((notif, idx) => `
            <div onclick="this.style.opacity='0.6';" style="padding: 15px 20px; border-bottom: 1px solid #e2e8f0; cursor: pointer; transition: background 0.2s; background: ${notif.is_read ? '#f8fafc' : '#f0f9ff'};" onmouseover="this.style.background='${notif.is_read ? '#f1f5f9' : '#e0f2fe'}'" onmouseout="this.style.background='${notif.is_read ? '#f8fafc' : '#f0f9ff'}'">
              <div style="display: flex; gap: 12px;">
                <i class="${notif.icon}" style="color: ${notif.color}; font-size: 1.25rem; flex-shrink: 0; margin-top: 2px;"></i>
                <div style="flex: 1;">
                  <div style="font-weight: 700; color: var(--dark);">${notif.title}</div>
                  <div style="font-size: 0.9rem; color: var(--gray); margin-top: 4px;">${notif.message}</div>
                  <div style="font-size: 0.8rem; color: var(--gray); margin-top: 6px; opacity: 0.7;">${new Date(notif.created_at).toLocaleString('ar-SA')}</div>
                </div>
                ${!notif.is_read ? '<div style="width: 8px; height: 8px; background: var(--primary); border-radius: 50%; flex-shrink: 0; margin-top: 6px;"></div>' : ''}
              </div>
            </div>
          `).join('')}
        `}
      </div>
      <div style="padding: 15px; border-top: 1px solid #e2e8f0; display: flex; justify-content: center;">
        <button class="btn-primary" onclick="closeModal()"><i class="fas fa-times"></i> إغلاق</button>
      </div>
    </div>`;

  showModal(panel);
}

// تحميل الإعدادات عند بدء التطبيق
document.addEventListener('DOMContentLoaded', function() {
  loadNotificationSettings();
  createNotificationsContainer();
}, { once: true });