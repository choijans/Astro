import { Suspense } from 'react';
import { ChannelsPage } from '../components/ChannelsPage';

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ChannelsPage />
    </Suspense>
  );
}
