import type { Clock } from '../common/clock';
import type { CommandsService } from '../commands/commands.service';
import type { FavouritesRepository } from './favourites.repository';
import { FavouritesService } from './favourites.service';

function createMocks() {
  const commandsService = {
    enqueue: jest.fn().mockResolvedValue({ id: 'cmd-1', status: 'DONE' }),
  } as unknown as CommandsService;

  const favouritesRepository = {
    listFavourites: jest.fn().mockResolvedValue([]),
  } as unknown as FavouritesRepository;

  const clock: Clock = { now: () => new Date('2026-01-01T00:00:00Z') };

  return { commandsService, favouritesRepository, clock };
}

describe('FavouritesService', () => {
  it('add() enqueues an ADD_FAVORITE command through CommandsService.enqueue — no other write path', async () => {
    const { commandsService, favouritesRepository, clock } = createMocks();
    const service = new FavouritesService(commandsService, favouritesRepository, clock);

    await service.add('user-1', 42, 'cmd-1');

    expect(commandsService.enqueue).toHaveBeenCalledWith({
      id: 'cmd-1',
      userId: 'user-1',
      type: 'ADD_FAVORITE',
      channelId: 42,
    });
  });

  it('remove() enqueues a REMOVE_FAVORITE command through the same CommandsService.enqueue', async () => {
    const { commandsService, favouritesRepository, clock } = createMocks();
    const service = new FavouritesService(commandsService, favouritesRepository, clock);

    await service.remove('user-1', 42, 'cmd-2');

    expect(commandsService.enqueue).toHaveBeenCalledWith({
      id: 'cmd-2',
      userId: 'user-1',
      type: 'REMOVE_FAVORITE',
      channelId: 42,
    });
  });

  it('list() reads through FavouritesRepository, not CommandsService', async () => {
    const { commandsService, favouritesRepository, clock } = createMocks();
    const service = new FavouritesService(commandsService, favouritesRepository, clock);

    await service.list('user-1');

    expect(favouritesRepository.listFavourites).toHaveBeenCalledWith('user-1');
    expect(commandsService.enqueue).not.toHaveBeenCalled();
  });
});
