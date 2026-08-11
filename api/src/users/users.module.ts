import { Module } from '@nestjs/common';
import { PasswordModule } from '../auth/password.module';
import { ClientsController } from './clients.controller';
import { StaffController } from './staff.controller';
import { UsersController } from './users.controller';
import { UsersRepository } from './users.repository';

@Module({
  imports: [PasswordModule],
  controllers: [UsersController, StaffController, ClientsController],
  providers: [UsersRepository],
  exports: [UsersRepository],
})
export class UsersModule {}
