import { ChannelDetailsPage } from '../../../components/ChannelDetailsPage';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ChannelDetailsPage idParam={id} />;
}
