import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Award, CalendarDays, Camera, ChevronLeft, CirclePlay, Crown, Gem, Gift, Heart, Images, MapPin, Package, PartyPopper, ShieldCheck, ShoppingBag, Sparkles, Star, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useGetFeaturedProducts, useListServices } from "@workspace/api-client-react";
import { usePublicSettings } from "@/lib/public-settings";
import { useContentLocalizer } from "@/lib/content-i18n";
import { formatCurrency } from "@/lib/money";
import { FeaturedKoshasSection } from "@/views/koshas";

const heroSlides = [
  { image: "/images/hero.png", label: "حفلات زفاف", title: "تفاصيل تُرى وتُحَس" },
  { image: "/images/kosha.png", label: "كوشات", title: "منصة تحتفي بلحظتك" },
  { image: "/images/photo.png", label: "تصوير", title: "صور تبقى بعد انتهاء الحفل" },
];
const quickLinks = [
  [Camera, "التصوير", "نروي القصة كما حدثت", "/services"], [Crown, "الكوشات", "مساحات مصممة للمشهد", "/koshas"], [Award, "التخرج", "احتفال يليق بالإنجاز", "/graduation"], [Sparkles, "الباقات", "ابدأ بخيار متكامل", "/services"],
  [ShoppingBag, "المتجر", "تفاصيل تُهدى وتُحتفظ", "/store"], [Gift, "الهدايا", "اختيارات ذات معنى", "/store"],
] as const;
const gallery = ["/images/kosha.png", "/images/photo.png", "/images/setup.png", "/images/gifts.png", "/images/album.png"];

function SectionHeading({ hint, title, link }: { hint: string; title: string; link?: { text: string; href: string } }) {
  return <div className="ajn-home-heading"><div><p>{hint}</p><h2>{title}</h2></div>{link && <Link href={link.href} className="ajn-home-text-link">{link.text}<ArrowLeft className="h-4 w-4" /></Link>}</div>;
}

export default function Home() {
  const { data: settings } = usePublicSettings();
  const { data: services = [], isLoading: loadingServices } = useListServices();
  const { data: featuredProducts, isLoading: loadingProducts } = useGetFeaturedProducts();
  const cl = useContentLocalizer(); const [slide, setSlide] = useState(0);
  const products = useMemo(() => (Array.isArray(featuredProducts) ? featuredProducts : (featuredProducts as any)?.items || (featuredProducts as any)?.data || []).slice(0, 4), [featuredProducts]);
  useEffect(() => { const timer = window.setInterval(() => setSlide((value) => (value + 1) % heroSlides.length), 5500); return () => window.clearInterval(timer); }, []);
  return <div className="ajn-home" dir="rtl">
    <section className="ajn-home-hero" aria-label="AJN Group">
      <div className="ajn-home-hero-media" aria-hidden="true">{heroSlides.map((item, index) => <img key={item.image} src={item.image} alt="" className={index === slide ? "is-active" : ""} />)}<div className="ajn-home-hero-scrim" /></div>
      <div className="ajn-home-hero-content"><div className="ajn-home-hero-copy"><p className="ajn-home-kicker"><span /> مجموعة علي جان</p><h1>نصنع لحظاتك<br /><em>بإتقان واحتراف</em></h1><p className="ajn-home-intro">من أول فكرة إلى آخر تفصيلة، نصمم احتفالاً متكاملاً يعكس ذوقك ويجعل حضورك لا يُنسى.</p><div className="ajn-home-hero-actions"><Link href="/services"><Button size="lg" className="ajn-home-primary">احجز موعدك الآن</Button></Link><Link href="/gallery"><Button size="lg" variant="outline" className="ajn-home-ghost">استكشف أعمالنا</Button></Link></div><div className="ajn-home-stats">{[["٢٥٠٠+","مناسبة منفذة"],["١٢٠٠+","عميل سعيد"],["٢٠+","فرداً في الفريق"]].map(([value,label]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}</div></div><div className="ajn-home-slide-card"><span>{heroSlides[slide].label}</span><h2>{heroSlides[slide].title}</h2><div className="ajn-home-dots">{heroSlides.map((item,index)=><button key={item.label} onClick={()=>setSlide(index)} aria-label={`عرض ${item.label}`} className={slide===index?"is-active":""}/>)}</div></div></div>
      <a href="#services" className="ajn-home-scroll" aria-label="انتقل إلى الخدمات"><span />اسحب للاستكشاف</a>
    </section>

    <section id="services" className="ajn-home-section ajn-home-services"><div className="container mx-auto px-4"><SectionHeading hint="كل ما تحتاجه في مناسبة واحدة" title="خدمات متصلة، بأسلوبك أنت" link={{text:"كل الخدمات",href:"/services"}}/><div className="ajn-home-service-grid">{quickLinks.map(([Icon,title,text,href],index)=><Link key={title} href={href} className="ajn-home-service-card"><span className="ajn-home-service-index">0{index+1}</span><Icon /><div><h3>{title}</h3><p>{text}</p></div><ArrowLeft className="ajn-home-service-arrow" /></Link>)}</div>{loadingServices ? <div className="mt-8 grid gap-4 sm:grid-cols-3">{[1,2,3].map((i)=><Skeleton key={i} className="h-44 rounded-2xl"/>)}</div> : services.length ? <div className="ajn-home-service-strip">{services.slice(0,3).map((service:any)=><Link href={`/services/${service.id}`} key={service.id}><img src={service.image || "/images/setup.png"} alt={cl.name(service)||service.name} loading="lazy"/><span>{cl.name(service)||service.name}</span></Link>)}</div>:null}</div></section>

    <section className="ajn-home-section ajn-home-packages"><div className="container mx-auto px-4"><SectionHeading hint="خيارات مصممة للبدء بثقة" title="اختياراتنا المميزة" link={{text:"تصفح الكوشات",href:"/koshas"}}/><div className="ajn-home-product-grid">{loadingProducts ? [1,2,3,4].map(i=><Skeleton className="h-[27rem] rounded-2xl" key={i}/>) : products.map((product:any,index:number)=><article className={`ajn-home-product-card ${index===0?"is-featured":""}`} key={product.id}><Link href={`/store/${product.id}`}><div className="ajn-home-product-photo"><img src={(Array.isArray(product.images)?product.images[0]:null)||product.imageUrl||"/images/gifts.png"} alt={cl.name(product)||product.name} loading="lazy"/>{index===0&&<span>اختيار الموسم</span>}<button aria-label="أضف للمفضلة" onClick={(event)=>event.preventDefault()}><Heart className="h-4 w-4"/></button></div></Link><div className="ajn-home-product-body"><p>AJN SELECT</p><h3>{cl.name(product)||product.name}</h3><span className="ajn-home-product-price">{formatCurrency(Number(product.price||0))}</span><div className="ajn-home-product-actions"><Link href={`/store/${product.id}`}><Button size="sm">التفاصيل</Button></Link><Link href="/cart"><Button size="sm" variant="outline">احجز الآن</Button></Link></div></div></article>)}</div></div></section>

    <FeaturedKoshasSection />

    <section className="ajn-home-section ajn-home-story"><div className="container mx-auto px-4"><div className="ajn-home-story-layout"><div className="ajn-home-story-image"><img src="/images/setup.png" alt="فريق AJN أثناء تجهيز مناسبة" loading="lazy"/><span><Gem />عناية بالتفاصيل</span></div><div><p className="ajn-home-kicker"><span /> لماذا AJN</p><h2>الرفاهية لا تأتي من كثرة التفاصيل، بل من اختيارها الصحيح.</h2><p className="ajn-home-intro">فريق واحد يجمع الإبداع والتجهيز والتنفيذ في رحلة منظمة، لتبقى أنت قريباً من فرحتك وليس من تفاصيلها التشغيلية.</p><div className="ajn-home-reasons">{[[Users,"فريق متخصص","خبرات موزعة على كل مرحلة"],[ShieldCheck,"تنفيذ موثوق","متابعة واضحة من الحجز للتسليم"],[Star,"ذوق مميز","تصميمات تترك انطباعاً حقيقياً"]].map(([Icon,title,text]:any)=><div key={title}><Icon /><span><b>{title}</b><small>{text}</small></span></div>)}</div><Link href="/services"><Button className="ajn-home-dark-button">تعرف على طريقة عملنا</Button></Link></div></div></div></section>

    <section className="ajn-home-section ajn-home-gallery"><div className="container mx-auto px-4"><SectionHeading hint="من حفلاتنا القريبة" title="لحظات نفخر بأن نكون جزءاً منها" link={{text:"زيارة المعرض",href:"/gallery"}}/><div className="ajn-home-mosaic">{gallery.map((image,index)=><Link href="/gallery" key={image} className={`ajn-home-mosaic-item is-${index+1}`}><img src={image} alt="من أعمال AJN" loading="lazy"/><span><Images className="h-4 w-4"/>عرض المشروع</span></Link>)}</div></div></section>

    <section className="ajn-home-film"><img src="/images/hero.png" alt="" loading="lazy"/><div><span>AJN FILM</span><h2>شاهد كيف تتحول الفكرة إلى ليلة كاملة</h2><Link href="/gallery"><button className="ajn-home-play" aria-label="شاهد أعمالنا"><CirclePlay /></button></Link></div></section>

    <section className="ajn-home-section ajn-home-process"><div className="container mx-auto px-4"><SectionHeading hint="خطوات واضحة، تجربة هادئة" title="من الفكرة إلى الاحتفال"/><ol>{[["اختر","الخدمة أو الباقة المناسبة"],["نسّق","التاريخ والتفاصيل مع فريقنا"],["اعتمد","الخطة والدفع بثقة"],["احتفل","وننفذ كل شيء في موعده"]].map(([step,text],index)=><li key={step}><span>0{index+1}</span><b>{step}</b><p>{text}</p></li>)}</ol></div></section>

    <section className="ajn-home-section ajn-home-reviews"><div className="container mx-auto px-4"><div className="ajn-home-review"><div><p className="ajn-home-kicker"><span /> تجارب موثقة</p><blockquote>“كل شيء كان مدروساً، من أول تنسيق إلى آخر صورة. شعرنا أن المناسبة تشبهنا فعلاً.”</blockquote><p className="ajn-home-review-author">— زينة وكرم <span>حفل زفاف</span></p></div><div className="ajn-home-rating"><strong>٤.٩</strong><div>★★★★★</div><span>من تقييمات عملائنا</span></div></div></div></section>

    <section className="ajn-home-section ajn-home-faq"><div className="container mx-auto px-4"><SectionHeading hint="إجابات قبل أن تبدأ" title="أسئلة شائعة"/><div className="ajn-home-faq-list">{[["كيف أبدأ الحجز؟","اختر الخدمة أو الباقة، ثم أرسل طلب الموعد. يتواصل معك الفريق لتأكيد التفاصيل."],["هل يمكن تخصيص الباقات؟","نعم، نرتب الخيارات والتفاصيل بما يتناسب مع فكرتك وموقع المناسبة."],["أين أتابع حجزي؟","يمكنك متابعة الحجز من بوابة العميل باستخدام بياناتك أو رمز التتبع."]].map(([question,answer])=><details key={question}><summary>{question}<ChevronLeft className="h-5 w-5"/></summary><p>{answer}</p></details>)}</div></div></section>
  </div>;
}
