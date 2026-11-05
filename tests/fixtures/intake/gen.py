# 收文登記測試用虛構來文：python3 gen.py（在這個資料夾裡執行）
# 全部內容、人名、案號、金額、繳款編號都是虛構的。
import json, random
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from PIL import Image, ImageDraw, ImageFont, ImageFilter
FONT = '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc'
pdfmetrics.registerFont(TTFont('WQY', FONT, subfontIndex=0))
random.seed(5)

DOCS = {
 '01_判決.pdf': ('judgment', [
  '臺灣臺北地方法院民事判決',
  '113年度訴字第101號',
  '原告　林小華（虛構）',
  '被告　甲營造股份有限公司（虛構）',
  '上列當事人間請求損害賠償事件，本院判決如下：',
  '主文',
  '被告應給付原告新臺幣參拾萬元。',
  '如不服本判決，應於判決送達後20日內向本院提出上訴狀。',
  '中華民國115年10月28日',
  '民事第一庭　法官　虛構甲']),
 '02_裁定.pdf': ('ruling', [
  '臺灣桃園地方法院民事裁定',
  '113年度訴字第305號',
  '原告　黃志豪（虛構）',
  '被告　對造地主丙（虛構）',
  '主文',
  '本件原告聲請調查證據駁回。',
  '如不服本裁定，應於裁定送達後10日內向本院提出抗告狀。',
  '中華民國115年10月27日']),
 '03_開庭通知書.pdf': ('hearing', [
  '臺灣臺北地方法院　通知書',
  '受通知人：虛構法律事務所　王大明律師',
  '案號：113年度訴字第101號',
  '案由：損害賠償',
  '應到時間：中華民國115年11月26日上午10時30分',
  '應到處所：本院第12法庭',
  '發文日期：中華民國115年10月30日',
  '請準時到庭，攜帶本通知書。']),
 '04_調解通知書.pdf': ('hearing', [
  '臺灣新北地方法院　家事調解通知書',
  '案號：115年度婚字第20號',
  '受通知人：虛構法律事務所　陳志明律師',
  '調解期日：中華民國115年12月3日下午2時',
  '調解處所：本院第3調解室',
  '發文日期：中華民國115年10月29日']),
 '05_補繳裁判費裁定.pdf': ('court_fee', [
  '臺灣臺北地方法院民事裁定',
  '115年度訴字第2468號',
  '原告　王虛構（虛構）',
  '上列原告與被告虛構商行間請求給付貨款事件，原告起訴未繳足裁判費。',
  '主文',
  '原告應於收受本裁定送達後五日內，補繳第一審裁判費新臺幣壹萬貳仟參佰元，逾期不補正，即駁回其訴。',
  '中華民國115年10月30日']),
 '06_法院繳費通知.pdf': ('court_fee', [
  '臺灣新北地方法院　繳費通知書',
  '案號：115年度婚字第20號',
  '主旨：請繳納鑑定費用新臺幣參仟元整。',
  '應繳金額：新臺幣參仟元整',
  '繳款期限：中華民國115年11月18日',
  '發文日期：中華民國115年10月31日']),
 '07_郵局繳款通知單.pdf': ('agency_payment', [
  '中華郵政股份有限公司',
  '辦理公務機關查詢債務人存款作業費用繳款通知單',
  '受文者：虛構法律事務所',
  '繳款編號：9100115103000123',
  '發文日期：中華民國115年10月30日',
  '發文字號：○○院○家○115年度重家繼訴8字第1150099999號',
  '應繳金額：新臺幣壹佰元整',
  '繳款期限：中華民國115年11月20日',
  '說明：本公司依法院來函辦理查詢債務人存款，請於期限內繳納作業費用。']),
 '08_法院函.pdf': ('letter', [
  '臺灣臺北地方法院　函',
  '受文者：虛構法律事務所',
  '發文日期：中華民國115年10月29日',
  '發文字號：北院英民玄113訴101字第1150088888號',
  '主旨：請於文到7日內陳報被告最新送達地址，請查照。',
  '說明：本院寄送被告之文書遭退回。']),
 '09_對造答辯狀繕本.pdf': ('opp_brief', [
  '民事答辯狀（繕本）',
  '案號：113年度訴字第305號',
  '股別：平股',
  '被告　對造地主丙（虛構）',
  '為就原告請求分割共有物事件，依法提出答辯事：',
  '一、原告之請求為無理由，應予駁回。',
  '中華民國115年10月26日']),
 '10_言詞辯論筆錄.pdf': ('transcript', [
  '臺灣臺北地方法院　言詞辯論筆錄',
  '113年度訴字第101號',
  '時間：中華民國115年10月21日上午9時30分',
  '地點：本院第5法庭',
  '法官　虛構甲　書記官　虛構乙',
  '點呼當事人，兩造均到庭。']),
 '11_送達證書.pdf': ('service_cert', [
  '送達證書',
  '案號：113年度訴字第305號',
  '應受送達人：虛構法律事務所　林淑芬律師',
  '送達文書：民事裁定',
  '送達日期：中華民國115年11月2日',
  '送達處所：虛構市虛構區範例路1號']),
 '12_其他.pdf': ('other', [
  '虛構事務用品股份有限公司',
  '115年冬季型錄',
  '影印紙、碳粉匣、檔案夾特價中。',
  '歡迎來電洽詢。']),
}

def pdf_text(name, lines):
    c = canvas.Canvas(name, pagesize=A4); y = 790
    for l in lines:
        # 依實際寬度換行（不要把數字切斷到兩行）
        cur = ''
        for ch in l:
            if pdfmetrics.stringWidth(cur + ch, 'WQY', 13) > 480: c.setFont('WQY', 13); c.drawString(55, y, cur); y -= 22; cur = ''
            cur += ch
        c.setFont('WQY', 13); c.drawString(55, y, cur); y -= 22
    c.showPage(); c.save()

def image_of(lines, dpi=200, noisy=False):
    W, H = int(8.27*dpi), int(11.69*dpi); im = Image.new('L', (W, H), 255); d = ImageDraw.Draw(im)
    fs = int(15/72*dpi); f = ImageFont.truetype(FONT, fs); y = int(0.9*dpi); x = int(0.8*dpi)
    for l in lines:
        for k in range(0, len(l), 28): d.text((x, y), l[k:k+28], font=f, fill=0); y += int(fs*1.7)
    if noisy:
        im = im.rotate(random.uniform(-0.6, 0.6), fillcolor=255, resample=Image.BICUBIC)
        px = im.load()
        for _ in range(W*H//90): px[random.randrange(W), random.randrange(H)] = random.randint(120, 210)
        im = im.filter(ImageFilter.GaussianBlur(0.3))
    return im.convert('RGB')

truth = {}
for name, (cat, lines) in DOCS.items():
    pdf_text(name, lines); truth[name] = {'category': cat, 'text': '\n'.join(lines), 'scan': False}
# 掃描版（沒有文字層，要 OCR）
for src, out, noisy in [('07_郵局繳款通知單.pdf', 'S07_郵局繳款通知單_掃描.pdf', False), ('05_補繳裁判費裁定.pdf', 'S05_補繳裁判費裁定_掃描.pdf', True), ('03_開庭通知書.pdf', 'S03_開庭通知書_掃描.pdf', False)]:
    cat, lines = DOCS[src]; im = image_of(lines, 200, noisy); im.save(out, resolution=200)
    truth[out] = {'category': cat, 'text': '\n'.join(lines), 'scan': True}
# 照片（手機拍的繳款通知單：PNG）
cat, lines = DOCS['07_郵局繳款通知單.pdf']
im = image_of(lines, 110, False); im = im.crop((0, 0, im.width, int(im.height*0.55))); im.save('P07_郵局繳款通知單_照片.png')
truth['P07_郵局繳款通知單_照片.png'] = {'category': cat, 'text': '\n'.join(lines), 'scan': True}
json.dump(truth, open('truth.json', 'w'), ensure_ascii=False, indent=1)
print('ok', len(truth))
