import { Module } from '@nestjs/common';
import { StaffController } from './staff.controller';
import { UsersController } from './users.controller';
import { UsersRepository } from './users.repository';

@Module({
  controllers: [UsersController, StaffController],
  providers: [UsersRepository],
  exports: [UsersRepository],
})
export class UsersModule {}
