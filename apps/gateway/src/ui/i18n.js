/**
 * Thai/English switch for the two public surfaces.
 *
 * English stays the served HTML, so link previews, crawlers and the surface
 * tests all keep reading English. Thai is applied in the browser from the
 * dictionary below and remembered per visitor.
 *
 * Static copy: put `data-i18n="key"` on the leaf element holding the text.
 * Dynamic copy (demo.js): call `ATI18N.t(key, englishText, vars)`.
 */
(() => {
  const STORE_KEY = "agenttab.lang";

  const TH = {
    "nav.product": "ภาพรวม",
    "nav.demo": "ลองเล่นเดโม",
    "nav.console": "หน้าจัดการ",

    "l.eyebrow": "ใช้ DFlow บนเครือข่าย Solana",
    "l.title": "เงินไม่พอ ก็ไม่ต้องหยุดงาน",
    "l.lede":
      "AgentTab แลก SOL ที่คุณมีอยู่ เป็นเงินที่ต้องจ่าย เฉพาะส่วนที่ขาด แล้วปล่อยให้งานเดินต่อ เอเจนต์ไม่ต้องหยุดมาขอเงินคุณ และคุณไม่ต้องไปนั่งเทรดเอง",
    "l.cta": "ลองเล่นเดโม",
    "l.badge": "เดโมปลอดภัย ไม่ใช้เงินจริง",
    "l.card.req": "สิ่งที่คุณสั่ง",
    "l.card.task": "จ่ายค่าสมาชิกรายเดือน",
    "l.card.state": "ต้องจ่ายเงินก่อน",
    "l.card.eq":
      "คุณมี 1.50 ดอลลาร์ ค่าบริการ 5.00 ดอลลาร์ AgentTab เติมให้ 3.50 ดอลลาร์",
    "l.card.have": "คุณมี",
    "l.card.have.sub": "ในวอลเล็ต",
    "l.card.cost": "ค่าบริการ",
    "l.card.cost.sub": "สำหรับงานนี้",
    "l.card.cover": "AgentTab เติมให้",
    "l.card.cover.sub": "เฉพาะส่วนที่ขาด",
    "l.flow.1": "รับงาน",
    "l.flow.2": "ต้องจ่าย",
    "l.flow.3": "เติมแล้ว",
    "l.flow.4": "จ่ายแล้ว",
    "l.flow.5": "ได้ผลลัพธ์",
    "l.card.note":
      "คุณได้ผลลัพธ์ที่สั่งไว้ ส่วนเรื่องเงินขาด AgentTab จัดการให้เบื้องหลัง",
    "l.loop.eyebrow": "วงจรเดียว จบในตัว",
    "l.loop.title": "เอเจนต์ของคุณทำงานต่อได้เรื่อยๆ",
    "l.loop.body":
      "คุณสั่งงาน ไม่ได้สั่งโอนเงิน พอเจอขั้นตอนที่ต้องจ่ายแล้วเงินในวอลเล็ตไม่พอ AgentTab เติมส่วนที่ขาดให้ งานเดิมก็เดินต่อ โดยไม่ต้องเปิดให้เอเจนต์ใช้เงินได้ไม่จำกัด",
    "l.step1.t": "เอเจนต์เจอบริการที่ต้องจ่ายเงิน",
    "l.step1.p": "กำลังทำงานที่คุณสั่งอยู่ แล้วมาถึงขั้นที่ต้องจ่ายค่าบริการ",
    "l.step2.t": "AgentTab เติมส่วนที่ขาด",
    "l.step2.p":
      "กฎที่คุณตั้งไว้เป็นคนตัดสินว่าจ่ายได้ไหม และเติมให้แค่ส่วนที่ขาดเท่านั้น ไม่เกินนั้น",
    "l.step3.t": "งานเสร็จ",
    "l.step3.p":
      "จ่ายค่าบริการเรียบร้อย ผลลัพธ์กลับมา และมีบันทึกหนึ่งชุดบอกว่าเกิดอะไรขึ้นบ้าง",
    "l.trust.lead": "ทดสอบจริงครบวงจรบน Solana Mainnet แล้ว",
    "l.trust.rest":
      " เว็บนี้เป็นแค่เดโมปลอดภัย แต่วงจรเดียวกันนี้เคยจ่ายเงินจริงมาแล้ว",
    "l.trust.fund": "รายการแลกเหรียญ",
    "l.trust.pay": "รายการจ่ายเงิน",
    "l.trust.audit": "ดูบันทึกทั้งหมด",
    "l.foot.powered": "ใช้ DFlow บนเครือข่าย Solana",
    "foot.src": "ดูซอร์สโค้ดบน GitHub →",

    "d.kicker": "เดโมแบบกดเล่นได้",
    "d.title": "สั่งผลลัพธ์ ไม่ต้องสั่งโอนเงิน",
    "d.sub": "เลือกงานสักอย่าง แล้วดูว่า AgentTab พางานไปต่อยังไงตอนเงินไม่พอ",
    "d.step1.kicker": "เลือกงาน",
    "d.step1.h2": "อยากให้เอเจนต์จ่ายค่าอะไร",
    "d.block.task": "บริการที่ต้องจ่ายเงิน",
    "d.task.sub.cat": "ค่าสมาชิก",
    "d.task.sub.name": "จ่ายค่าสมาชิกรายเดือน",
    "d.task.sub.price": "เดือนละ $5.00",
    "d.task.ai.cat": "agentic AI",
    "d.task.ai.name": "จ่ายค่าบริการ agentic AI",
    "d.task.ai.price": "ครั้งละ $1.25",
    "d.block.wallet": "เงินในวอลเล็ตตอนเริ่ม",
    "d.sc.partial": "มี USDC บางส่วน",
    "d.sc.empty": "มีแต่ SOL ไม่มี USDC เลย",
    "d.sc.funded": "มี USDC พอจ่ายแล้ว",
    "d.run": "เริ่มงานนี้",
    "d.hint":
      "เดโมปลอดภัย ไม่ใช้เงินจริง AgentTab เติมให้แค่ส่วนที่งานนี้ขาดเท่านั้น",
    "d.step2.kicker": "งานของคุณ",
    "d.step2.h2": "จากเงินขาด สู่ผลลัพธ์",
    "d.badge": "เดโมปลอดภัย ไม่ใช้เงินจริง",
    "d.loading": "กำลังโหลดงานที่ทำอยู่…",
    "d.foot.title": "ยืนยันแล้วบน Solana Mainnet",
    "d.foot.note": "หน้านี้เป็นเดโมปลอดภัย ไม่มีการใช้เงินจริงบน Mainnet",
    "d.foot.proof": "ดูหลักฐานฝั่งเทคนิค →",

    "d.beat.request": "รับงาน",
    "d.beat.challenge": "ต้องจ่าย",
    "d.beat.cover": "เติมแล้ว",
    "d.beat.cover.none": "ไม่ต้องเติม",
    "d.beat.pay": "จ่ายแล้ว",
    "d.beat.result": "ผลลัพธ์",
    "d.state.waiting": "รอคุณกดยืนยัน",
    "d.state.covering": "กำลังเติมส่วนที่ขาด",
    "d.state.paying": "กำลังจ่ายและทำต่อ",
    "d.state.done": "งานเสร็จแล้ว",
    "d.btn.pay": "จ่าย {ask} แล้วไปต่อ",
    "d.btn.cover": "เติม {gap} ที่ขาด แล้วไปต่อ",
    "d.btn.continue": "ทำงานเดิมต่อ",
    "d.powered": "เบื้องหลังใช้ DFlow",
    "d.active": "งานที่ทำอยู่",
    "d.purpose.subscription": "จ่ายค่าสมาชิกรายเดือน",
    "d.purpose.agentic-ai": "จ่ายค่าบริการ agentic AI",
    "d.eq.has": "ในวอลเล็ตมี",
    "d.eq.has.sub": "ก่อนเริ่มงานนี้",
    "d.eq.needs": "ค่าบริการ",
    "d.eq.needs.sub": "สำหรับงานนี้",
    "d.eq.covers": "AgentTab เติมให้",
    "d.eq.covers.sub": "เฉพาะส่วนที่ขาด",
    "d.eq.covers.none": "ไม่ต้องเติม",
    "d.story.short":
      "ในวอลเล็ตมี {hold} จากค่าบริการ {ask} ที่ต้องจ่าย AgentTab จะแลก SOL ที่มีอยู่ มาเติมส่วนที่ขาด {gap}",
    "d.story.ok":
      "ในวอลเล็ตมีพอจ่ายงานนี้แล้ว AgentTab จะจ่ายแล้วทำต่อ ไม่มีส่วนที่ต้องเติม",
    "d.story.done.short":
      "AgentTab แลก SOL มาเติมส่วนที่ขาด {gap} จ่ายค่าบริการ {ask} แล้วงานของคุณก็เดินต่อจนจบ",
    "d.story.done.ok":
      "ในวอลเล็ตมี {ask} พอจ่ายงานนี้อยู่แล้ว AgentTab เลยจ่ายแล้วทำต่อได้เลย",
    "d.done.label": "งานเสร็จแล้ว",
    "d.result.subscription": "ต่ออายุสมาชิกอีกหนึ่งเดือนแล้ว",
    "d.result.subscription.sub":
      "ผู้ให้บริการรับค่าต่ออายุแล้ว แพ็กเกจของคุณเลยใช้ต่อได้ไม่สะดุด",
    "d.result.agentic-ai": "จ่ายค่าบริการ agentic AI แล้ว",
    "d.result.agentic-ai.sub":
      "บริการ AI ที่เอเจนต์ต้องใช้ตอบกลับมาแล้ว งานที่คุณสั่งเลยทำต่อจนจบได้",
    "d.tech.summary": "เบื้องหลังการทำงาน",
    "d.tech.swap": "แลกเหรียญผ่าน DFlow",
    "d.tech.swap.none": "ไม่ต้องแลก วอลเล็ตมี USDC พอแล้ว",
    "d.tech.swap.exact": " (เท่าที่ขาดพอดี)",
    "d.tech.pay": "จ่ายผ่าน x402",
    "d.tech.pay.to": " ไปที่ผู้ให้บริการ",
    "d.tech.api": "API ที่จ่ายเงินไปเรียก",
    "d.tech.proof": "รหัสยืนยันผลลัพธ์",
    "d.tech.pending": "รออยู่",
    "d.tech.done": "เสร็จแล้ว",
    "d.empty.none": "ตอนนี้ยังไม่มีงานที่ทำอยู่ เลือกงานแล้วกดเริ่มได้เลย",
    "d.empty.expired":
      "งานนี้รอยืนยันนานเกินไป เลยจ่ายไม่ได้แล้ว เริ่มงานใหม่ด้านบนได้เลย",
    "d.empty.reset":
      "งานนี้ถูกรีเซ็ตโดยเครื่องเดโมที่ใช้ร่วมกัน เริ่มงานใหม่ด้านบนได้เลย",
    "d.status.covering": "AgentTab กำลังแลก SOL มาเติมส่วนที่ขาด…",
    "d.status.done": "งานของคุณเสร็จแล้ว",
    "d.status.state": "สถานะ: {state}",
    "d.status.starting": "กำลังเริ่มงานให้…",
    "d.status.ready": "งานของคุณพร้อมแล้ว",
    "d.status.apply": "กดเริ่มงานเพื่อใช้ตัวเลือกที่เลือกไว้",
    "d.status.needstack":
      "ปุ่มกดเล่นใช้ได้เฉพาะตอนรันเดโมสแตก (pnpm demo:stack หรือบน Railway)",
    "d.mode.mock": "เดโมปลอดภัย ไม่ใช้เงินจริง",

    "o.brand": "ซื้อเฉพาะเหรียญที่ขาด แล้วทำงานเดิมต่อจนจบ",
    "o.surface": "หน้าสำหรับตรวจฝั่งเทคนิค",
    "o.view.now": "ตอนนี้",
    "o.view.ledger": "ประวัติ",
    "o.view.policy": "กฎการจ่าย",
    "o.stance.loading": "กำลังโหลดกฎที่ใช้อยู่…",
    "o.observe": "โหมดเฝ้าดูและอนุญาต ไม่ใช่โหมดทดลอง รายการที่เข้าเงื่อนไขยังจ่ายเงินจริงได้",
    "o.foot": "กดปฏิเสธแล้วย้อนไม่ได้ ส่วนหน้าพรีวิวไม่ขยับเงิน",
    "o.foot.contract": "สัญญาสำหรับเครื่อง",
    "o.unlock.title": "ปลดล็อก AgentTab",
    "o.unlock.body": "เกตเวย์นี้ต้องใส่โทเคนก่อน ถึงจะเห็นยอดใช้จ่าย กฎ และรายการที่รออนุมัติ โทเคนเก็บไว้ในแท็บนี้เท่านั้น",
    "o.unlock.label": "โทเคนของเกตเวย์",
    "o.unlock.cta": "เข้าใช้งาน",
    "o.policy.title": "กฎการจ่ายเงิน",
    "o.policy.sub": "กฎที่ใช้จริงกับการจ่ายครั้งถัดไป ไม่ใช่สำเนาไฟล์ในเครื่อง",
    "o.policy.when": "ให้ AgentTab จ่ายตอนไหน",
    "o.policy.who": "อนุญาตให้จ่ายใครได้บ้าง",
    "o.policy.allow": "เพิ่มผู้ให้บริการ",
    "o.policy.limits": "วงเงิน",
    "o.policy.savelimits": "บันทึกวงเงิน",
    "o.mode.observe": "เฝ้าดูและอนุญาต",
    "o.mode.observe.sub": "ไม่ใช่โหมดทดลอง กฎหลวมกว่า และรายการที่เข้าเงื่อนไขยังใช้เงินได้จริง",
    "o.mode.approve": "ถามฉันทุกครั้ง",
    "o.mode.approve.sub": "ทุกการจ่ายจะไปรออยู่ที่ ตอนนี้ จนกว่าคุณจะอนุมัติหรือปฏิเสธ",
    "o.mode.autopay": "จ่ายอัตโนมัติในวงเงิน",
    "o.mode.autopay.sub": "ผู้ให้บริการที่อนุญาตไว้จ่ายได้เองไม่เกินวงเงิน โดยไม่หยุดเอเจนต์",
    "o.field.origin": "ที่อยู่ผู้ให้บริการ",
    "o.field.maxpay": "จ่ายได้สูงสุดต่อครั้ง",
    "o.field.maxday": "จ่ายได้สูงสุดต่อวัน",
    "o.field.askabove": "เกินเท่าไหร่ให้ถามฉัน",
    "o.field.wants": "สิ่งที่เอเจนต์ต้องการ",
    "o.field.usd": "จำนวนเงิน (USD)",
    "o.field.network": "เครือข่าย",
    "o.net.local": "ในเครื่อง",
    "o.net.local.full": "ในเครื่อง (ไม่ขึ้นเชน)",
    "o.net.unknown": "เครือข่ายที่ไม่รู้จัก",
    "o.check.title": "ลองยิงการจ่ายเข้ากฎชุดนี้",
    "o.check.hint": "ตรวจกับกฎที่ใช้อยู่เท่านั้น ไม่สร้างรายการ ไม่เติมเงิน ไม่จ่าย ไม่ส่งของ",
    "o.check.cta": "ตรวจกับกฎ",
    "o.check.allow": "AgentTab จะอนุญาตรายการนี้",
    "o.check.wait": "รายการนี้จะไปรออยู่ที่ ตอนนี้",
    "o.check.deny": "AgentTab จะปฏิเสธรายการนี้",
    "o.json.title": "แก้กฎเป็น JSON (ขั้นสูง)",
    "o.json.hint": "เอกสารชุดเดียวกับที่ CLI และ SDK เขียน เครือข่ายและเหรียญอยู่ในนี้ ส่วนจำนวนเงินเก็บเป็นหน่วยหนึ่งในล้านดอลลาร์",
    "o.json.save": "บันทึก JSON",
    "o.note.everypayment": "ทุกการจ่ายต้องขออนุมัติ",
    "o.rail.wallet": "วอลเล็ต",
    "o.rail.policy": "กฎการจ่าย",
    "o.rail.spend": "ยอดใช้จ่าย",
    "o.rail.mode": "โหมด",
    "o.rail.waiting": "รอคุณอยู่",
    "o.rail.spenttoday": "ใช้ไปวันนี้",
    "o.rail.inflight": "กันไว้ระหว่างทาง",
    "o.rail.dailycap": "วงเงินต่อวัน",
    "o.stance.spent": "ใช้ไป",
    "o.stance.of": "จาก",
    "o.stance.today": "วันนี้",
    "o.stance.held": "กันไว้ระหว่างทาง",
    "o.stance.signed": " · แจ้งเตือนแบบเซ็นกำกับ",
    "o.stance.alerts": " · เปิดแจ้งเตือน",
    "o.state.discovered": "เจอแล้ว",
    "o.state.approval_required": "รอคุณยืนยัน",
    "o.state.approved": "อนุมัติแล้ว",
    "o.state.funding_submitted": "กำลังเติมเงิน",
    "o.state.funded": "พร้อมจ่าย",
    "o.state.payment_submitted": "กำลังจ่าย",
    "o.state.paid": "จ่ายแล้ว",
    "o.state.fulfilled": "เสร็จแล้ว",
    "o.state.fulfillment_failed": "ส่งของไม่สำเร็จ",
    "o.state.denied": "ถูกปฏิเสธ",
    "o.state.failed": "ล้มเหลว",
    "o.state.updated": "อัปเดตแล้ว",
    "o.event.payment.discovered": "เอเจนต์ไปเจอบริการที่ต้องจ่ายเงิน",
    "o.event.policy.approval_required": "AgentTab หยุด 402 ไว้รอคุณ",
    "o.event.approval.granted": "คุณอนุมัติ",
    "o.event.approval.denied": "คุณปฏิเสธ",
    "o.event.policy.denied": "กฎที่ใช้อยู่ไม่อนุญาตให้จ่าย",
    "o.event.funding.submitted": "กำลังซื้อเฉพาะส่วนที่ขาดพอดี",
    "o.event.funding.attempt_locked": "ล็อกรอบการเติมเงินไว้แล้ว",
    "o.event.funding.plan_receipt": "ได้แผนการเติมเงินแล้ว",
    "o.event.funding.failed": "เติมเงินไม่สำเร็จ",
    "o.event.funding.no_candidate": "ไม่มีเหรียญที่อนุญาตให้ใช้เติมเงิน",
    "o.event.funding.signer_failed": "เติมเงินหยุดไว้ก่อน รายการเดิมลองใหม่ได้",
    "o.event.funding.confirm_interrupted": "รอยืนยันการเติมเงิน รายการเดิมลองใหม่ได้",
    "o.event.funding.balances_applied": "อัปเดตยอดในวอลเล็ตแล้ว",
    "o.event.funding.confirmed": "ได้เหรียญที่ขาดแล้ว วอลเล็ตจ่าย 402 ได้",
    "o.event.funding.not_required": "วอลเล็ตมีเหรียญที่ต้องจ่ายอยู่แล้ว",
    "o.event.payment.submitted": "กำลังจ่าย 402",
    "o.event.payment.settled": "จ่ายผู้ให้บริการเรียบร้อย",
    "o.event.payment.token_issued": "ออกโทเคนการจ่ายในเครื่องแล้ว",
    "o.event.payment.attempt_failed": "จ่ายไม่สำเร็จ รายการเดิมลองใหม่ได้",
    "o.event.resource.fulfilled": "งานเดิมเดินต่อแล้ว",
    "o.event.resource.fulfillment_failed": "จ่ายแล้ว แต่ยังไม่ได้ของ",
    "o.reason.approval_threshold_exceeded": "กฎตั้งไว้ว่าต้องถามคุณก่อนจ่ายจำนวนนี้",
    "o.reason.merchant_not_allowed": "ผู้ให้บริการรายนี้ไม่ได้อยู่ในรายชื่อที่อนุญาต",
    "o.reason.merchant_denied": "ผู้ให้บริการรายนี้ถูกห้ามไว้ชัดเจน",
    "o.reason.network_not_allowed": "เครือข่ายนี้ไม่ได้รับอนุญาต",
    "o.reason.payment_asset_not_allowed": "เหรียญที่ใช้จ่ายนี้ไม่ได้รับอนุญาต",
    "o.reason.funding_asset_not_allowed": "เหรียญที่ใช้เติมเงินไม่ได้รับอนุญาต",
    "o.reason.unverified_funding_asset": "เหรียญที่ใช้เติมเงินยังไม่ผ่านการตรวจสอบ",
    "o.reason.usd_value_unknown": "AgentTab ไม่รู้มูลค่าเป็นดอลลาร์ของรายการนี้",
    "o.reason.per_payment_limit_exceeded": "จำนวนนี้เกินวงเงินต่อครั้ง",
    "o.reason.daily_limit_exceeded": "จ่ายแล้วจะเกินวงเงินของวันนี้",
    "o.reason.challenge_expired": "คำขอชำระเงินหมดอายุแล้ว",
    "o.reason.parked_approval_expired": "รายการที่พักไว้หมดอายุแล้ว เติมเงินให้ไม่ได้",
    "o.reason.invalid_intent": "รายละเอียดการจ่ายไม่ถูกต้อง",
    "o.reason.allowed": "กฎที่ใช้อยู่จะอนุญาตรายการนี้",
    "o.verdict.ready-to-pay.state": "พร้อมจ่าย",
    "o.verdict.ready-to-pay.line": "วอลเล็ตมีเหรียญที่ผู้ให้บริการขอมาอยู่แล้ว",
    "o.verdict.ready-to-pay.why": "ตรงนี้ไม่ต้องใช้ DFlow เพราะ AgentTab จะแลกเหรียญก็ต่อเมื่อของที่ต้องจ่ายขาดเท่านั้น",
    "o.verdict.action-required.state": "ต้องให้คุณตัดสินใจ",
    "o.verdict.action-required.line": "เอเจนต์ไปเจอ API ที่ต้องจ่ายเงิน แต่วอลเล็ตมีเหรียญที่ผู้ให้บริการขอไม่พอ",
    "o.verdict.action-required.why": "ตรงนี้ต้องใช้ DFlow ถ้าไม่แลกเหรียญเท่าที่ขาด เอเจนต์จะค้างอยู่ที่เงินไม่พอ",
    "o.verdict.expired.state": "หมดอายุ",
    "o.verdict.expired.line": "รายการนี้รอเกินเวลาที่กำหนด เลยเติมเงินให้ไม่ได้แล้ว",
    "o.verdict.expired.why": "AgentTab เลือกให้หมดอายุ ดีกว่าไปจ่ายตามข้อมูลเก่า กดปฏิเสธ หรือเริ่มรายการใหม่",
    "o.verdict.stopped.state": "หยุดแล้ว",
    "o.verdict.stopped.line": "รายการนี้จะไม่ถูกเติมเงิน เอเจนต์เลยไปต่อไม่ได้",
    "o.verdict.stopped.why": "เมื่อการจ่ายหลุดกรอบกฎที่ตั้งไว้ AgentTab จะหยุดไว้ก่อนเสมอ",
    "o.verdict.running.state": "กำลังทำงาน",
    "o.verdict.running.line": "กำลังซื้อเฉพาะส่วนที่ขาด แล้วจ่ายผู้ให้บริการและทำงานเดิมต่อ",
    "o.verdict.running.why": "เหรียญที่ซื้อผ่าน DFlow ผูกอยู่กับรายการนี้และจำนวนที่ขาดพอดีเท่านั้น",
    "o.verdict.done.state": "เสร็จแล้ว",
    "o.verdict.done.line": "เอเจนต์ได้สิ่งที่ขอไป หนึ่งคำขอ หนึ่งการจ่าย ไม่ต้องเปิดหน้าจอเทรด",
    "o.verdict.done.why": "บันทึกชุดเดียวร้อยการแลกผ่าน DFlow การจ่าย x402 และผลลัพธ์ที่ได้เข้าด้วยกัน",
    "o.verdict.idle.state": "ว่าง",
    "o.verdict.idle.line": "รอเอเจนต์ไปเจอบริการที่ต้องจ่ายเงิน",
    "o.verdict.idle.why": "ถ้าเหรียญที่ต้องใช้จ่ายขาด AgentTab จะซื้อมาเฉพาะส่วนที่ขาดพอดี",
    "o.beat.resource": "คำขอที่ต้องจ่าย",
    "o.beat.resource.t": "เอเจนต์ต้องใช้บริการที่ต้องจ่ายเงิน",
    "o.beat.resource.d": "คำขอ HTTP ตัวเดิม",
    "o.beat.asked": "ผู้ให้บริการขอ",
    "o.beat.asked.t": "ผู้ให้บริการขอเหรียญแบบเจาะจง",
    "o.beat.asked.t2": "ผู้ให้บริการขอเหรียญนี้",
    "o.beat.asked.d": "x402 ระบุเหรียญและจำนวนไว้ชัดเจน",
    "o.beat.missing": "วอลเล็ตขาด",
    "o.beat.missing.t": "วอลเล็ตไม่มีเหรียญนั้น",
    "o.beat.missing.past": "ตอนนั้นวอลเล็ตไม่มีเหรียญนั้น",
    "o.beat.missing.d": "มูลค่าพอ แต่ถือผิดเหรียญหรือมีไม่พอ",
    "o.beat.held": "มีอยู่แล้ว",
    "o.beat.held.t": "วอลเล็ตมีเหรียญนั้นอยู่แล้ว",
    "o.beat.held.past": "ตอนนั้นวอลเล็ตมีเหรียญนั้นอยู่แล้ว",
    "o.beat.buy": "ซื้อส่วนที่ขาด",
    "o.beat.buy.t": "ซื้อเฉพาะส่วนที่ขาดพอดี",
    "o.beat.nobuy": "ไม่ต้องซื้อ",
    "o.beat.nobuy.t": "ไม่ต้องแลกผ่าน DFlow",
    "o.beat.nobuy.d": "ข้ามไป จ่ายจากยอดที่มีในวอลเล็ตได้เลย",
    "o.beat.finish": "จ่ายแล้วไปต่อ",
    "o.beat.finish.t": "จ่ายแล้วทำงานเดิมต่อ",
    "o.beat.finish.t2": "จ่ายผู้ให้บริการ แล้วทำงานเดิมต่อ",
    "o.beat.finish.d": "ปลายทางเดิม ไม่มีการจ่ายรอบสอง",
    "o.beat.finish.done": "งานเดิมเดินต่อแล้ว",
    "o.deficit.holds": "ในวอลเล็ตมี",
    "o.deficit.ask": "x402 ขอ",
    "o.deficit.asknobuy": "x402 ขอ · ไม่ต้องแลกผ่าน DFlow",
    "o.deficit.exact": "ส่วนที่ขาดพอดี",
    "o.kicker.deniedafter": "กฎปฏิเสธหลังจากคุณอนุมัติไปแล้ว",
    "o.kicker.deniedpolicy": "ถูกกฎปฏิเสธ",
    "o.kicker.rejected": "ถูกปฏิเสธ",
    "o.kicker.fundingfailed": "เติมเงินไม่สำเร็จ",
    "o.kicker.completed": "เสร็จแล้ว",
    "o.kicker.undelivered": "จ่ายแล้ว แต่ยังไม่ได้ของ",
    "o.kicker.merchantpaid": "จ่ายผู้ให้บริการแล้ว",
    "o.kicker.paying": "กำลังจ่ายผู้ให้บริการ",
    "o.kicker.held": "เหรียญที่ขาดเข้าวอลเล็ตแล้ว",
    "o.kicker.buying": "กำลังซื้อเฉพาะส่วนที่ขาด",
    "o.kicker.canpay": "วอลเล็ตจ่ายได้แล้ว รอคุณยืนยัน",
    "o.kicker.expired": "รายการที่พักไว้หมดอายุ",
    "o.kicker.action": "ต้องให้คุณตัดสินใจ",
    "o.amount.unfundable": "รายการนี้เติมเงินให้ไม่ได้แล้ว",
    "o.amount.missing": "ขาดอยู่ {gap} ซื้อแค่เท่านี้ แล้วไปต่อ",
    "o.step.task": "งานของเอเจนต์",
    "o.step.expired": "รายการที่พักไว้นี้หมดอายุตามเวลาที่กฎกำหนด เติมเงินให้ไม่ได้แล้ว กดปฏิเสธ หรือรอรายการใหม่",
    "o.step.needbuy": "เอเจนต์จะดึง {access} ไม่ได้จนกว่าวอลเล็ตจะมี {asked} AgentTab จะซื้อมาแค่ {gap} จาก {from} ผ่าน {how} แล้วจ่ายผู้ให้บริการ และยิงคำขอเดิมซ้ำ",
    "o.step.held": "วอลเล็ตมี {asked} อยู่แล้ว กดยืนยันแล้วจะจ่ายผู้ให้บริการและยิง {access} ซ้ำ ไม่ต้องแลกผ่าน DFlow",
    "o.step.fundingpaused": "การซื้อ {gap} หยุดค้างอยู่ที่รายการเดิมนี้ กดไปต่อจะซื้อเฉพาะส่วนที่ยังขาดผ่าน {how}",
    "o.step.funded": "{gap} เข้าวอลเล็ตแล้ว กดไปต่อจะจ่าย {asked} และยิง {access} ซ้ำ จะไม่ซื้อหรือจ่ายซ้ำสอง",
    "o.step.submitted": "ส่งคำสั่งจ่ายไปแล้ว กดไปต่อจะยืนยันการจ่ายเดิมและยิง {access} ซ้ำ",
    "o.step.paid": "จ่ายผู้ให้บริการไป {asked} แล้ว กดไปต่อจะทำเครื่องหมายว่า {access} ส่งถึงแล้ว เอเจนต์จะได้ทำงานต่อ",
    "o.step.undelivered": "จ่ายแล้ว แต่ {access} ยังไม่ถูกทำเครื่องหมายว่าส่งถึง กดไปต่อจะลองส่งใหม่อย่างเดียว",
    "o.step.failed": "เติมเงินไม่สำเร็จก่อนที่งานเดิมจะเดินต่อ กฎอนุญาตรายการนี้แล้ว แต่การซื้อไม่จบ",
    "o.step.done": "เอเจนต์ได้ {access} หลังจาก AgentTab {what} {asked}",
    "o.did.paid": "จ่าย",
    "o.did.bought": "ซื้อ {gap} แล้วจ่าย",
    "o.step.deniedafter": "กฎที่ใช้อยู่ปฏิเสธรายการนี้หลังคุณอนุมัติ ({why}) รายการนี้จะไม่ถูกเติมเงิน",
    "o.step.denied": "กฎที่ใช้อยู่ปฏิเสธการจ่ายนี้ ({why})",
    "o.step.youdenied": "คุณปฏิเสธการจ่ายนี้ มันจะไม่ถูกเติมเงินและไม่ถูกจ่าย",
    "o.res.this": "ปลายทางนี้",
    "o.res.the": "ของที่ขอ",
    "o.res.orig": "คำขอเดิม",
    "o.resume.plan": "การเติมเงินหยุดกลางคันตอนวางแผนหรือเซ็น กดไปต่อจะใช้รหัสการจ่ายเดิม ไม่เปิดการแลกรอบสอง",
    "o.resume.held": "วอลเล็ตมีเหรียญที่ต้องจ่ายแล้ว กดไปต่อจะบันทึกการจ่ายของรหัสเดิมนี้",
    "o.resume.submitted": "ส่งคำสั่งจ่ายไปแล้วแต่ยังไม่จบ กดไปต่อจะยืนยันการจ่ายเดิม ไม่สร้างรายการใหม่",
    "o.resume.paid": "จ่ายผู้ให้บริการแล้ว กดไปต่อจะทำเครื่องหมายว่าของที่ขอส่งถึงแล้ว",
    "o.resume.undelivered": "จ่ายแล้ว แต่ของที่ขอยังไม่ถูกทำเครื่องหมายว่าส่งถึง กดไปต่อจะลองส่งใหม่อย่างเดียว",
    "o.resume.approved": "อนุมัติแล้ว แต่การเติมเงินยังไม่จบ กดไปต่อจะทำรายการเดิมนี้ต่อ",
    "o.btn.pay": "จ่าย {asked} แล้วไปต่อ",
    "o.btn.buy": "ซื้อ {gap} แล้วไปต่อ",
    "o.btn.paycontinue": "จ่ายแล้วทำงานเดิมต่อ",
    "o.btn.continueorig": "ทำงานเดิมต่อ",
    "o.btn.finishbuy": "ซื้อส่วนที่ขาดให้จบ",
    "o.btn.continue": "ทำรายการนี้ต่อ",
    "o.confirm.pay": "ยืนยันจ่ายแล้วไปต่อ",
    "o.confirm.buy": "ยืนยันซื้อแล้วไปต่อ",
    "o.confirm.continue": "ยืนยันแล้วไปต่อ",
    "o.confirm.reject": "ยืนยันการปฏิเสธ",
    "o.confirm.rejectnote": "กดปฏิเสธแล้วย้อนไม่ได้ รายการนี้จะไม่ถูกเติมเงินหรือจ่าย และใช้รหัสเดิมซ้ำไม่ได้",
    "o.filter.aria": "กรองรายการ",
    "o.filter.all": "ทั้งหมด",
    "o.filter.completed": "เสร็จแล้ว",
    "o.filter.needsapproval": "รออนุมัติ",
    "o.filter.rejected": "ถูกปฏิเสธ",
    "o.proof.title": "พิสูจน์บน Solana Mainnet มาแล้ว",
    "o.proof.sub": "หน้านี้ไม่ใช้เงินจริงบน Mainnet แต่วงจรเดียวกันนี้เคยจบบนเชนมาแล้ว:",
    "o.proof.dflow": "รายการแลกเท่าที่ขาดผ่าน DFlow",
    "o.proof.x402": "รายการจ่ายผ่าน x402",
    "o.proof.continued": "แล้วงานเดิมก็เดินต่อ",
    "o.proof.local": "รันในเครื่อง:",
    "o.merchant.local": "ผู้ให้บริการจำลองในเครื่อง",
    "o.merchant.unknown": "ผู้ให้บริการที่ไม่รู้จัก",
    "o.msg.badorigin": "ที่อยู่นี้ใช้ไม่ได้",
    "o.msg.keepmerchant": "ต้องเหลือผู้ให้บริการอย่างน้อยหนึ่งราย กฎที่ใช้อยู่จะไม่บันทึกรายชื่อว่าง",
    "o.msg.amount": "ใส่จำนวนเงินเป็นดอลลาร์",
    "o.msg.buying": "กำลังซื้อเฉพาะเหรียญที่ขาด…",
    "o.msg.rejected": "ปฏิเสธแล้ว รายการนี้ใช้ซ้ำไม่ได้",
    "o.msg.paying": "กำลังจ่ายผู้ให้บริการ…",
    "o.msg.continuingorig": "กำลังทำงานเดิมต่อ…",
    "o.msg.continuing": "กำลังทำรายการนี้ต่อ…",
    "o.msg.origcontinued": "งานเดิมเดินต่อแล้ว",
    "o.status.approved": "อนุมัติแล้ว",
    "o.demo.request": "คำขอนี้",
    "o.demo.done": "{task} เสร็จแล้ว หลัง AgentTab เติมส่วนที่ขาดและจ่ายผู้ให้บริการ",
    "o.beat.received": "เอเจนต์ได้รับ {access}",
    "o.result.delivered": "ส่งของเรียบร้อย",
    "o.proof.hmac": "จ่ายด้วย HMAC ในเครื่อง",
    "o.proof.label": "หลักฐาน:",
    "o.demo.short": "วอลเล็ตขาดอยู่ {gap} กดอนุมัติครั้งเดียว AgentTab จะเติมให้แค่นั้น จ่ายผู้ให้บริการ แล้วงานก็เดินต่อ",
    "o.demo.held": "วอลเล็ตมี {asked} อยู่แล้ว กดอนุมัติเพื่อจ่ายผู้ให้บริการแล้วไปต่อ",
    "o.beat.heldmissing": "มีอยู่ {hold} · ขาดอีก {gap}",
    "o.btn.back": "ย้อนกลับ",
    "o.btn.reject": "ปฏิเสธ",
    "o.btn.rejectexpired": "ปฏิเสธรายการที่หมดอายุ",
    "o.btn.newrequest": "เริ่มรายการใหม่",
    "o.card.nextscenario": "กำลังโหลดสถานการณ์ถัดไป…",
    "o.card.tech": "รายละเอียดทางเทคนิค",
    "o.card.endpoint": "ปลายทาง",
    "o.card.agent": "เอเจนต์",
    "o.status.continued": "ไปต่อแล้ว",
    "o.msg.policysaved": "บันทึกกฎแล้ว",
    "o.msg.limitssaved": "บันทึกกฎแล้ว: อัปเดตวงเงินเรียบร้อย",
    "o.msg.jsonsaved": "บันทึกกฎแล้ว: อัปเดต JSON เรียบร้อย",
    "o.msg.deniedafter": "กฎปฏิเสธรายการนี้หลังคุณอนุมัติ",
    "o.msg.fundingfailed": "เติมเงินไม่สำเร็จ",
    "o.msg.buyunfinished": "การซื้อไม่จบ",
    "o.msg.observemainnet": "โหมดเฝ้าดูและอนุญาต ไม่ใช่โหมดทดลอง รายการที่เข้าเงื่อนไขยังเติมเงินและจ่ายจริงบน Mainnet ได้"
  };

  function stored() {
    try {
      return localStorage.getItem(STORE_KEY);
    } catch {
      // Private modes throw on access; English is the safe default.
      return null;
    }
  }

  function remember(lang) {
    try {
      localStorage.setItem(STORE_KEY, lang);
    } catch {
      // Nothing to do: the switch still works for this page view.
    }
  }

  function fill(text, vars) {
    if (!vars) return text;
    return text.replace(/\{(\w+)\}/g, (whole, name) =>
      vars[name] === undefined ? whole : vars[name]
    );
  }

  const listeners = [];

  const api = {
    lang: stored() === "th" ? "th" : "en",

    /** English is the source text, so it doubles as the fallback. */
    t(key, english, vars) {
      const text = api.lang === "th" ? (TH[key] ?? english) : english;
      return fill(text, vars);
    },

    apply() {
      const th = api.lang === "th";
      document.documentElement.lang = th ? "th" : "en";
      for (const node of document.querySelectorAll("[data-i18n]")) {
        if (node.dataset.i18nEn === undefined) node.dataset.i18nEn = node.textContent;
        const key = node.dataset.i18n;
        node.textContent = th ? (TH[key] ?? node.dataset.i18nEn) : node.dataset.i18nEn;
      }
      for (const node of document.querySelectorAll("[data-i18n-aria]")) {
        if (node.dataset.i18nAriaEn === undefined) {
          node.dataset.i18nAriaEn = node.getAttribute("aria-label") ?? "";
        }
        const key = node.dataset.i18nAria;
        node.setAttribute(
          "aria-label",
          th ? (TH[key] ?? node.dataset.i18nAriaEn) : node.dataset.i18nAriaEn
        );
      }
      for (const fn of listeners) fn(api.lang);
    },

    onChange(fn) {
      listeners.push(fn);
    },

    set(lang) {
      api.lang = lang === "th" ? "th" : "en";
      remember(api.lang);
      api.apply();
    }
  };

  window.ATI18N = api;

  function wire() {
    const button = document.getElementById("lang-toggle");
    if (button) {
      // The button always offers the other language, never the current one.
      const paint = () => {
        button.textContent = api.lang === "th" ? "EN" : "ไทย";
        button.setAttribute(
          "aria-label",
          api.lang === "th" ? "Switch to English" : "เปลี่ยนเป็นภาษาไทย"
        );
      };
      api.onChange(paint);
      button.addEventListener("click", () => api.set(api.lang === "th" ? "en" : "th"));
      paint();
    }
    api.apply();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();
