import { Module } from '@nestjs/common';
import { ClientsController } from './clients.controller';
import { StaffController } from './staff.controller';
import { UsersController } from './users.controller';
import { UsersRepository } from './users.repository';

@Module({
  controllers: [UsersController, StaffController, ClientsController],
  providers: [UsersRepository],
  exports: [UsersRepository],
})
export class UsersModule {}
