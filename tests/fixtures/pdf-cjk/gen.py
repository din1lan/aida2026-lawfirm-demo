import json, random
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase import _cidfontdata
_cidfontdata.defaultUnicodeEncodings['MSung-Light']=('cht','UniCNS-UCS2-H')
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from PIL import Image, ImageDraw, ImageFont
pdfmetrics.registerFont(UnicodeCIDFont('MSung-Light'))  # 未內嵌明體、UniCNS-UCS2-H（Type0/CID）
random.seed(7)
NAMES=['甲○○','乙○○','丙○○']
BASE=['臺灣虛構地方法院民事判決　一一三年度訴字第九九九號',
 '原告　甲○○（虛構）　住虛構市虛構區測試路一號',
 '被告　乙○○（虛構）　住虛構市虛構區範例街二號',
 '上列當事人間請求返還借款事件，本院於民國一一三年十月一日言詞辯論終結，判決如下：',
 '主文　被告應給付原告新臺幣參拾伍萬元，及自起訴狀繕本送達翌日起至清償日止，按年息百分之五計算之利息。',
 '事實及理由　一、原告主張：被告於民國一一二年三月五日向原告借款新臺幣參拾伍萬元，約定同年九月五日清償，屆期未還。',
 '二、被告則以：該筆款項係贈與而非借貸，且原告未能提出借據等語，資為抗辯。',
 '三、本院之判斷：按稱消費借貸者，謂當事人一方移轉金錢或其他代替物之所有權於他方，而約定他方以種類、品質、數量相同之物返還之契約，民法第四百七十四條第一項定有明文。',
 '經查原告提出之匯款單據及通訊軟體對話紀錄，足認兩造間確有借貸合意，被告所辯不足採信。',
 '四、綜上所述，原告依消費借貸之法律關係請求被告給付，為有理由，應予准許。訴訟費用由被告負擔。']
def page_lines(i):
    return [f'【虛構判決測試文件　第{i}頁】']+[l for l in BASE[ (i%3): ]]
def wrap(s,n=34): return [s[k:k+n] for k in range(0,len(s),n)]
def draw_text_page(c, lines):
    y=800
    for l in lines:
        for w in wrap(l):
            c.setFont('MSung-Light',13); c.drawString(50,y,w); y-=20
def image_of(lines):
    W,H=1240,1754; im=Image.new('RGB',(W,H),'white'); d=ImageDraw.Draw(im)
    f=ImageFont.truetype('/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',30); y=120
    for l in lines:
        for w in wrap(l): d.text((100,y),w,font=f,fill='black'); y+=44
    p='img_page.png'; im.save(p); return p
truth={}
def make(name, n, image_pages=()):
    c=canvas.Canvas(name,pagesize=A4); pages=[]
    for i in range(1,n+1):
        ls=page_lines(i)
        if i in image_pages:
            c.drawImage(image_of(ls),0,0,*A4); pages.append({'text':'\n'.join(ls),'image':True})
        else:
            draw_text_page(c,ls); pages.append({'text':'\n'.join(ls),'image':False})
        c.showPage()
    c.save(); truth[name]=pages
make('T1_CID字型_3頁.pdf',3)
make('T2_含圖片頁_3頁.pdf',3,image_pages=(2,))
make('T3_長文件_25頁.pdf',25)
json.dump(truth,open('truth.json','w'),ensure_ascii=False)
