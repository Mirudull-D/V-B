import { MapPin, Clock, Phone, Store, Smartphone, Mail } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen bg-[#FFFFFF] text-[#1A1A1A] font-sans flex flex-col justify-between selection:bg-[#3F3F46] selection:text-white">
      {/* Header */}
      <header className="border-b border-black/10 py-6 px-6 sm:px-12 flex justify-center items-center bg-white/90 backdrop-blur-md sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-xs p-1 border border-[#3F3F46]/30">
            <img src="/logo.jpeg" alt="VIJAYA LAKSHMI INDUSTRIES Logo" className="w-full h-full object-contain" />
          </div>
          <div>
            <span className="text-sm font-black text-[#3F3F46] tracking-wider uppercase block">
              VIJAYA LAKSHMI INDUSTRIES
            </span>
            <span className="text-[9px] text-[#52525B] font-bold tracking-widest block uppercase -mt-0.5">
              Kadambur
            </span>
          </div>
        </div>
      </header>

      {/* Main Info */}
      <main className="flex-1 max-w-xl mx-auto w-full px-6 flex flex-col justify-center items-center py-16">
        <div className="bg-white border border-[#3F3F46]/30 rounded-2xl p-8 sm:p-12 shadow-md w-full text-center relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-[#3F3F46] via-[#52525B] to-[#3F3F46]" />

          <span className="inline-block px-3 py-1 bg-[#3F3F46]/10 border border-[#3F3F46]/30 text-[#3F3F46] text-[10px] font-bold rounded-full tracking-wider uppercase mb-6">
            Store Directory & Contacts
          </span>

          <h1 className="text-3xl font-black text-[#3F3F46] leading-tight tracking-tight mb-2">
            VIJAYA LAKSHMI INDUSTRIES
          </h1>
          <p className="text-xs text-[#52525B] font-black tracking-widest uppercase mb-8">
            Pure Camphor • Puja Products
          </p>

          <div className="space-y-6 text-left max-w-md mx-auto text-sm font-semibold text-[#1A1A1A]/80 border-t border-black/10 pt-8">
            <div className="flex items-start gap-4">
              <Smartphone className="w-5 h-5 text-[#3F3F46] shrink-0 mt-0.5" />
              <div>
                <p className="text-[10px] font-bold text-black/50 uppercase tracking-wider mb-0.5">What We Offer</p>
                <p className="text-[#1A1A1A] leading-relaxed">
                  Pure Camphor • Camphor Tablets & Slabs • Puja & Devotional Products • Wholesale & Retail Supply
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <Store className="w-5 h-5 text-[#3F3F46] shrink-0 mt-0.5" />
              <div>
                <p className="text-[10px] font-bold text-black/50 uppercase tracking-wider mb-0.5">Location</p>
                <p className="text-[#1A1A1A] font-bold">
                  Kadambur, Tamil Nadu
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <MapPin className="w-5 h-5 text-[#3F3F46] shrink-0 mt-0.5" />
              <div>
                <p className="text-[10px] font-bold text-black/50 uppercase tracking-wider mb-0.5">Address</p>
                <p className="text-[#1A1A1A] leading-relaxed">
                  3, Kaliamman Kovil Street, Kadambur - 628714
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <Phone className="w-5 h-5 text-[#3F3F46] shrink-0 mt-0.5" />
              <div>
                <p className="text-[10px] font-bold text-black/50 uppercase tracking-wider mb-0.5">Phone Numbers</p>
                <p className="text-[#1A1A1A]">
                  9345124641
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <Mail className="w-5 h-5 text-[#3F3F46] shrink-0 mt-0.5" />
              <div>
                <p className="text-[10px] font-bold text-black/50 uppercase tracking-wider mb-0.5">Email</p>
                <p className="text-[#1A1A1A]">
                  mayilpurecamphor2023@gmail.com
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <Clock className="w-5 h-5 text-[#3F3F46] shrink-0 mt-0.5" />
              <div>
                <p className="text-[10px] font-bold text-black/50 uppercase tracking-wider mb-0.5">Business Hours</p>
                <p className="text-[#1A1A1A]">
                  Open Daily
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-black/10 py-6 text-center bg-white">
        <p className="text-[10px] font-bold text-[#3F3F46] tracking-widest uppercase">
          VIJAYA LAKSHMI INDUSTRIES • Kadambur
        </p>
        <p className="text-[9px] font-semibold text-black/40 uppercase tracking-wider mt-1">
          © {new Date().getFullYear()} All Rights Reserved • Powered by Cenexa Systems
        </p>
      </footer>
    </div>
  );
}
