'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useLeaveGame } from '@/context/LeaveGameContext';

export default function Footer() {
  const [dividerLoaded, setDividerLoaded] = useState(false);
  const [dividerError, setDividerError] = useState(false);
  const { inGame, requestLeaveGame, goToStartScreen } = useLeaveGame();

  const handleStartScreenClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (inGame) {
        requestLeaveGame();
      } else {
        goToStartScreen();
      }
    },
    [inGame, requestLeaveGame, goToStartScreen]
  );

  return (
    <footer className="site-footer">
      {!dividerError && (
        <div className="site-footer__divider-wrap">
          <img
            src="/images/hw_horizontal_divider.png"
            alt=""
            className="site-footer__divider"
            onError={() => setDividerError(true)}
          />
        </div>
      )}
      <div className="site-footer__inner">
        <nav className="site-footer__nav" aria-label="Footer navigation">
          <a
            href="/"
            className="site-footer__link"
            onClick={handleStartScreenClick}
          >
            Start Screen
          </a>
          <Link href="/how-to-play" className="site-footer__link">
            How to Play
          </Link>
          <Link href="/disclaimer" className="site-footer__link">
            Disclaimer
          </Link>
        </nav>
        <p className="site-footer__credit">
          Heroes & Wizards is a fan-made, non-commercial project. Not affiliated with the original creators.
        </p>
        <p className="site-footer__publisher">
          Official game:{' '}
          <a
            href="https://jofgames.com.au/heroes-and-wizards/"
            target="_blank"
            rel="noopener noreferrer"
            className="site-footer__publisher-link"
          >
            Jof Games — Heroes & Wizards
          </a>
        </p>
        <p className="site-footer__issues">
          Found a bug or want to leave a comment? Report bugs on the{' '}
          <a
            href="https://github.com/killianconsulting/heroes-wizards-online/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="site-footer__link"
          >
            Issues page
          </a>
          .
        </p>
        <p className="site-footer__support">
          Enjoying the game? You can{' '}
          <a
            href="https://ko-fi.com/incompletebiped"
            target="_blank"
            rel="noopener noreferrer"
            className="site-footer__kofi"
          >
            ☕ Buy Me a Coffee
          </a>
        </p>
      </div>
    </footer>
  );
}
