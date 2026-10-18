import React from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Bookmark, Heart, MessageCircle, Compass, Users, Sparkles, Globe2, CheckCircle2 } from "lucide-react";
import "./Hero.css";

const featureItems = [
  { icon: MessageCircle, tint: "lavender", title: "Meaningful conversations", description: "Turn quick thoughts into thoughtful discussions with people who get it." },
  { icon: Users, tint: "blue", title: "Communities that click", description: "Find your people around the interests, ideas and projects you love." },
  { icon: Heart, tint: "rose", title: "Connections that matter", description: "Build friendships, follow creators and support each other's progress." },
  { icon: Bookmark, tint: "amber", title: "Your personal library", description: "Save the posts and ideas you want to come back to, all in one place." },
];

function PublicFooter() {
  return <footer className="public-footer" id="contact"><div className="public-footer-brand"><Link to="/" className="navbar-brand"><img className="navbar-logo-image" src="/lumora-mark.svg" alt=""/><span className="navbar-brand-text"><strong>Lumora</strong><small>PEOPLE · IDEAS · STORIES · TOGETHER</small></span></Link><p>A modern space to read, share, connect and grow together.</p></div><div className="footer-links"><strong>Explore</strong><Link to="/services">Features</Link><Link to="/about">About Lumora</Link><Link to="/contact">Contact</Link></div><div className="footer-links"><strong>Your space</strong><Link to="/signup">Create account</Link><Link to="/login">Sign in</Link><Link to="/terms">Terms & privacy</Link></div><div className="footer-bottom"><span>© {new Date().getFullYear()} Lumora</span><span>Made for people and ideas.</span></div></footer>;
}

export default function Hero() {
  return (
    <main className="public-home">
      <section className="hero-section">
        <div className="hero-container">
          <div className="hero-content">
            <div className="hero-badge"><span className="hero-badge-dot"/> A LITTLE MORE HUMAN, A LITTLE MORE CONNECTED</div>
            <h1>A modern space to read, share, connect and <span>grow together.</span></h1>
            <p className="hero-description">Join a friendly community to share your ideas, discover new perspectives and build meaningful connections.</p>
            <div className="hero-actions"><Link to="/signup" className="hero-primary-btn">Get started <ArrowRight size={17}/></Link><Link to="/services" className="hero-secondary-btn"><Compass size={16}/> Explore features</Link></div>
            <div className="hero-social-proof"><div className="avatar-stack"><span>AY</span><span>MK</span><span>HS</span><span>FA</span><span>+</span></div><span>Made for curious minds and growing communities.</span></div>
          </div>
          <div className="hero-visual" aria-label="Lumora community preview">
            <div className="hero-visual-image"><div className="hero-image-overlay"/><div className="hero-image-topline"><span className="hero-label-dot"/> A PLACE TO BELONG</div><div className="hero-image-caption"><span>DISCOVER SOMETHING NEW</span><h2>Your next great<br/>conversation starts here.</h2></div></div>
            <div className="hero-floating-card hero-float-one"><span className="hero-floating-icon icon-lavender"><MessageCircle size={19}/></span><span><strong>Share ideas</strong><small>Let your thoughts travel.</small></span></div>
            <div className="hero-floating-card hero-float-two"><span className="hero-floating-icon icon-blue"><Users size={19}/></span><span><strong>Join communities</strong><small>Find your kind of people.</small></span></div>
            <div className="hero-floating-card hero-float-three"><span className="hero-floating-icon icon-rose"><Heart size={19}/></span><span><strong>Meaningful connections</strong><small>Grow together, every day.</small></span></div>
          </div>
        </div>
        <div className="hero-stats" aria-label="About Lumora"><div><strong>1.2K+</strong><span>Active users</span></div><div><strong>8.7K+</strong><span>Posts & discussions</span></div><div><strong>120+</strong><span>Communities</span></div><div><strong>Free</strong><span>To join</span></div></div>
      </section>

      <section className="public-section features-section" id="services"><div className="section-heading"><span className="section-eyebrow">A BETTER KIND OF SOCIAL</span><h2>All the good parts of being connected.</h2><p>Share what matters, discover something unexpected and find your place in the conversation.</p></div><div className="feature-grid">{featureItems.map(({icon: Icon,tint,title,description})=><article className="feature-card" key={title}><span className={`feature-icon ${tint}`}><Icon size={22}/></span><h3>{title}</h3><p>{description}</p><Link to="/services">Explore feature <ArrowRight size={15}/></Link></article>)}</div></section>

      <section className="community-promo" id="about"><div className="community-promo-image"><div className="community-photo-badge"><Globe2 size={17}/> Open to everyone</div></div><div className="community-promo-copy"><span className="section-eyebrow">YOUR PEOPLE ARE OUT THERE</span><h2>Big ideas grow better <span>together.</span></h2><p>From your first post to the community that feels like home, Lumora gives you a welcoming place to make connections that last beyond the scroll.</p><ul><li><CheckCircle2 size={18}/> Find groups around your interests</li><li><CheckCircle2 size={18}/> Have thoughtful, real-time conversations</li><li><CheckCircle2 size={18}/> Keep the posts that inspire you</li></ul><Link to="/about" className="hero-secondary-btn">Our story <ArrowRight size={16}/></Link></div></section>

      <section className="public-section how-section"><div className="section-heading"><span className="section-eyebrow">A SIMPLE PLACE TO START</span><h2>Your next chapter, in three steps.</h2></div><div className="steps-grid"><article><span>01</span><h3>Create your space</h3><p>Choose your name, personalize your profile and make Lumora yours.</p></article><article><span>02</span><h3>Find your people</h3><p>Explore posts, meet members and join communities around what you love.</p></article><article><span>03</span><h3>Share and grow</h3><p>Start a conversation, share an idea and build something meaningful.</p></article></div></section>

      <section className="public-cta"><div><span className="section-eyebrow">YOUR PEOPLE · YOUR SPACE</span><h2>Come as you are.<br/><span>Grow from here.</span></h2><p>Make room for new ideas, new perspectives and real connections.</p></div><Link to="/signup" className="hero-primary-btn">Join Lumora <ArrowRight size={17}/></Link><Sparkles className="cta-sparkle" size={70}/></section>
      <PublicFooter/>
    </main>
  );
}
